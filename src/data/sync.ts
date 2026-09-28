/**
 * Sync-Engine: gleicht diese Datenbank mit dem Sync-Server ab.
 *
 * Offline zuerst. Die App arbeitet immer lokal; der Sync ist ein Abgleich, der
 * läuft, wenn Netz da ist, und scheitern darf, ohne dass etwas verloren geht.
 *
 * Ein Durchlauf:
 *   1. Abholen, was andere Geräte seit dem letzten Mal geschickt haben
 *      (seitenweise, der Cursor wird nach jeder Seite gespeichert).
 *   2. Anwenden nach den Regeln aus `domain/sync.ts`; betroffene Karten werden
 *      aus dem vereinigten Review-Log neu berechnet (`replay`).
 *   3. Senden, was der Server noch nicht kennt — ermittelt als Differenz zur
 *      Tabelle `synced`, nicht über Buchführung in den Schreibpfaden.
 *   4. Was der Server ablehnt (er hat Neueres), kommt als dessen Stand zurück
 *      und wird wie Abgeholtes angewendet.
 *
 * Alle Inhalte reisen verschlüsselt (`lib/crypto.ts`). Verschlüsselt wird
 * außerhalb der Dexie-Transaktionen: ein fremdes `await` darin beendete sie.
 */
import { db } from './db'
import { SYNC_KEY_SETTING } from './repo'
import { newId } from '@/lib/id'
import { deriveSyncKeys, normalizeSyncKey, seal, unseal, type SyncKeys } from '@/lib/crypto'
import {
  COLLECTIONS,
  isCollection,
  looksLikeDataLoss,
  pendingChanges,
  remoteApplies,
  syncKey,
  tombstoneVersion,
  type CardMeta,
  type Collection,
  type SyncRecord,
} from '@/domain/sync'
import { initialState, replay } from '@/domain/srs'
import type { Card, Deck, ID, Note, Review } from './types'

const BASE = (import.meta.env.VITE_SYNC_URL as string | undefined) ?? '/api/sync'
const PUSH_BATCH = 500

const DEVICE = 'sync.device'
const CURSOR = 'sync.cursor'
const LAST_AT = 'sync.lastAt'

interface WireRecord {
  c: Collection
  id: string
  u: number
  del?: true
  d?: string
}

export interface SyncConfig {
  key: string
  /** Eigene Kennung je Verbindung — der Server schickt einem Gerät nichts zurück, was es selbst gesendet hat. */
  device: string
  cursor: number
  lastSyncAt: number | null
}

export type SyncErrorKind = 'offline' | 'auth' | 'server' | 'dataloss'

export class SyncError extends Error {
  readonly kind: SyncErrorKind
  constructor(kind: SyncErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface SyncSummary {
  pulled: number
  pushed: number
}

/* ------------------------------------------------------------------ *
 * Verbindung
 * ------------------------------------------------------------------ */

async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined
}

export async function loadSyncConfig(): Promise<SyncConfig | null> {
  const key = await getSetting<string>(SYNC_KEY_SETTING)
  const device = await getSetting<string>(DEVICE)
  if (!key || !device) return null
  return {
    key,
    device,
    cursor: (await getSetting<number>(CURSOR)) ?? 0,
    lastSyncAt: (await getSetting<number>(LAST_AT)) ?? null,
  }
}

/** Liegen unter diesem Schlüssel schon Daten? Für die Rückfrage beim Verbinden. */
export async function probeSyncKey(input: string): Promise<{ exists: boolean }> {
  const key = normalizeSyncKey(input)
  if (!key) throw new SyncError('auth', 'Der Schlüssel ist ungültig — bitte prüfen.')
  const keys = await deriveSyncKeys(key)
  const res = await post<{ exists: boolean }>(keys, 'pull', { device: 'probe', since: 0, limit: 1 })
  return { exists: res.exists }
}

/**
 * Dieses Gerät verbinden. Bestehende Daten bleiben und werden beim ersten
 * Abgleich mit dem Server vereinigt.
 *
 * `joining`: Es gibt dort schon Daten. Ein Gerät, auf dem es nie eine Notiz
 * gab (auch keine gelöschte), hat dann nur das automatisch angelegte leere
 * Startdeck — das wird weich gelöscht, statt als leeres Doppel auf allen
 * Geräten zu landen. Die strenge Bedingung ist Absicht: Decks, die schon
 * einmal synchronisiert waren, darf dieser Weg nie treffen, sonst verbreitete
 * sich die Löschung.
 */
export async function connectSync(input: string, opts: { joining: boolean }): Promise<void> {
  const key = normalizeSyncKey(input)
  if (!key) throw new SyncError('auth', 'Der Schlüssel ist ungültig — bitte prüfen.')
  const now = Date.now()
  await db.transaction('rw', [db.decks, db.notes, db.settings, db.synced], async () => {
    if (opts.joining) {
      if ((await db.notes.count()) === 0) {
        const decks = await db.decks.toArray()
        await db.decks.bulkPut(
          decks.filter((d) => !d.deletedAt).map((d) => ({ ...d, deletedAt: now, updatedAt: now })),
        )
      }
    }
    await db.synced.clear()
    await db.settings.bulkPut([
      { key: SYNC_KEY_SETTING, value: key, updatedAt: now },
      { key: DEVICE, value: newId(), updatedAt: now },
      { key: CURSOR, value: 0, updatedAt: now },
      { key: LAST_AT, value: null, updatedAt: now },
    ])
  })
  keyCache = null
}

/** Verbindung lösen. Die lokalen Daten bleiben, der Server behält seine. */
export async function disconnectSync(): Promise<void> {
  await db.transaction('rw', db.settings, db.synced, async () => {
    await db.settings.bulkDelete([SYNC_KEY_SETTING, DEVICE, CURSOR, LAST_AT])
    await db.synced.clear()
  })
  keyCache = null
}

/* ------------------------------------------------------------------ *
 * Abgleich
 * ------------------------------------------------------------------ */

let running: Promise<SyncSummary | null> | null = null

/**
 * Einen Abgleich ausführen. Läuft schon einer, wird dessen Ergebnis geteilt;
 * mehrere Tabs stimmen sich über eine Web Lock ab. `null`: kein Sync
 * eingerichtet.
 */
export function syncNow(): Promise<SyncSummary | null> {
  if (running) return running
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const job = locks ? locks.request('kartei-sync', () => runSync()) : runSync()
  running = job.finally(() => {
    running = null
  })
  return running
}

async function runSync(): Promise<SyncSummary | null> {
  const cfg = await loadSyncConfig()
  if (!cfg) return null
  const keys = await keysFor(cfg.key)

  /* 1 + 2: abholen und anwenden */
  let cursor = cfg.cursor
  let pulled = 0
  for (;;) {
    const res = await post<{ records: WireRecord[]; cursor: number; more: boolean; exists: boolean }>(
      keys,
      'pull',
      { device: cfg.device, since: cursor },
    )
    // Der Server steht hinter uns: er wurde zurückgesetzt oder aus einem
    // älteren Backup geholt. Dann gilt nichts mehr als bestätigt — alles
    // noch einmal senden, damit er wieder vollständig wird.
    if (cursor > 0 && (!res.exists || res.cursor < cursor)) {
      await db.transaction('rw', db.synced, db.settings, async () => {
        await db.synced.clear()
        await db.settings.put({ key: CURSOR, value: 0, updatedAt: Date.now() })
      })
      cursor = 0
      continue
    }
    const records = await openAll(keys.key, res.records)
    await applyRemote(records)
    cursor = res.cursor
    await db.settings.put({ key: CURSOR, value: cursor, updatedAt: Date.now() })
    pulled += records.length
    if (!res.more) break
  }

  /* 3 + 4: senden, Ablehnungen anwenden */
  const outgoing = await collectOutgoing()
  for (let i = 0; i < outgoing.length; i += PUSH_BATCH) {
    const batch = outgoing.slice(i, i + PUSH_BATCH)
    const res = await post<{ rejected: WireRecord[] }>(keys, 'push', {
      device: cfg.device,
      records: await sealAll(keys.key, batch),
    })
    const rejected = await openAll(keys.key, res.rejected)
    await acknowledge(batch, rejected)
    await applyRemote(rejected)
  }

  await db.settings.put({ key: LAST_AT, value: Date.now(), updatedAt: Date.now() })
  return { pulled, pushed: outgoing.length }
}

/** Alles, was der Server noch nicht kennt — Löschmarker für zurückgenommene Reviews inklusive. */
async function collectOutgoing(): Promise<SyncRecord[]> {
  const { pending, reviews, syncedReviews } = await db.transaction(
    'r',
    [db.decks, db.notes, db.cards, db.reviews, db.synced],
    async () => {
      const synced = new Map((await db.synced.toArray()).map((s) => [s.k, s.u]))
      const pending = pendingChanges({
        decks: await db.decks.toArray(),
        notes: await db.notes.toArray(),
        cards: await db.cards.toArray(),
        reviewIds: (await db.reviews.toCollection().primaryKeys()) as string[],
        synced,
      })
      const reviews = await db.reviews.bulkGet(pending.newReviewIds)
      let syncedReviews = 0
      for (const k of synced.keys()) if (k.startsWith('reviews/')) syncedReviews++
      return { pending, reviews, syncedReviews }
    },
  )

  if (looksLikeDataLoss(pending.deletedReviews.length, syncedReviews)) {
    throw new SyncError(
      'dataloss',
      `Auf diesem Gerät fehlen ${pending.deletedReviews.length} schon synchronisierte Antworten. ` +
        'Der Sync ist angehalten, damit sich der Verlust nicht auf andere Geräte überträgt. ' +
        'Verbindung trennen und neu verbinden holt alles vom Server zurück.',
    )
  }

  const now = Date.now()
  return [
    ...pending.records,
    ...reviews
      .filter((r): r is Review => r !== undefined)
      .map((r): SyncRecord => ({ c: 'reviews', id: r.id, u: r.ts, d: r })),
    ...pending.deletedReviews.map(
      ({ id, u }): SyncRecord => ({ c: 'reviews', id, u: tombstoneVersion(u, now), del: true }),
    ),
  ]
}

/** Vom Server angenommene Datensätze als bestätigt vermerken. */
async function acknowledge(sent: SyncRecord[], rejected: SyncRecord[]): Promise<void> {
  const refused = new Set(rejected.map((r) => syncKey(r.c, r.id)))
  await db.transaction('rw', db.synced, async () => {
    for (const r of sent) {
      const k = syncKey(r.c, r.id)
      if (refused.has(k)) continue
      if (r.del) await db.synced.delete(k)
      else await db.synced.put({ k, u: r.u })
    }
  })
}

/**
 * Datensätze vom Server anwenden. Eine Transaktion für alles: Entweder ist
 * eine Seite ganz angekommen oder gar nicht — und der Cursor rückt erst danach.
 */
export async function applyRemote(records: SyncRecord[]): Promise<void> {
  if (records.length === 0) return
  const ordered = [...records].sort((a, b) => COLLECTIONS.indexOf(a.c) - COLLECTIONS.indexOf(b.c))

  await db.transaction('rw', [db.decks, db.notes, db.cards, db.reviews, db.synced], async () => {
    const touched = new Set<ID>()
    const notesToCheck = new Set<ID>()
    const decksToCheck = new Set<ID>()
    const ack = (r: SyncRecord) => db.synced.put({ k: syncKey(r.c, r.id), u: r.u })

    for (const r of ordered) {
      if (r.c === 'reviews') {
        const local = await db.reviews.get(r.id)
        if (r.del) {
          if (local) {
            await db.reviews.delete(r.id)
            touched.add(local.cardId)
          }
          await db.synced.delete(syncKey(r.c, r.id))
          continue
        }
        const review = r.d as Review
        if (!local) {
          await db.reviews.add(review)
          touched.add(review.cardId)
        }
        await ack(r)
        continue
      }

      if (r.c === 'cards') {
        const meta = r.d as CardMeta
        const local = await db.cards.get(r.id)
        if (!local) {
          await db.cards.add({ ...initialState(meta.createdAt), ...meta } as Card)
        } else if (remoteApplies(r.u, local.updatedAt)) {
          await db.cards.put({ ...local, ...meta })
        } else {
          continue
        }
        touched.add(r.id)
        notesToCheck.add(meta.noteId)
        await ack(r)
        continue
      }

      const table = r.c === 'decks' ? db.decks : db.notes
      const local = await table.get(r.id)
      if (!remoteApplies(r.u, local?.updatedAt)) continue
      await table.put(r.d as Deck & Note)
      if (r.c === 'notes') notesToCheck.add(r.id)
      else decksToCheck.add(r.id)
      await ack(r)
    }

    await repairCascades(notesToCheck, decksToCheck)

    // Der FSRS-Zustand folgt dem vereinigten Log — nie dem, was ein anderes Gerät für richtig hielt.
    for (const id of touched) {
      const card = await db.cards.get(id)
      if (!card) continue
      const log = await db.reviews.where('cardId').equals(id).toArray()
      await db.cards.put({ ...card, ...replay(card.createdAt, log) })
    }
  })
}

/**
 * Was lokal nie entsteht, kann beim Zusammenführen entstehen: Jeder
 * Datensatz folgt für sich „neuer gewinnt“, die Beziehungen dazwischen nicht.
 * Zwei Regeln stellen sie wieder her — die Korrektur ist eine gewöhnliche
 * lokale Änderung und erreicht beim Senden alle anderen Geräte.
 *
 *   - Karte lebt, Notiz ist gelöscht → Karte löschen. Das Löschen der Notiz
 *     war die Absicht; Pausieren o. Ä. auf dem anderen Gerät war es nicht.
 *   - Notiz lebt, Deck ist gelöscht → Deck wiederherstellen. Neuer Inhalt
 *     geht nicht verloren, nur weil anderswo der Behälter gelöscht wurde.
 *     Geprüft von beiden Seiten: für angekommene Notizen und für angekommene
 *     Decks, in denen lokal noch lebende Notizen liegen.
 *
 * Läuft innerhalb der Transaktion von `applyRemote`.
 */
async function repairCascades(noteIds: Set<ID>, deckIds: Set<ID>): Promise<void> {
  const now = Date.now()
  for (const deckId of deckIds) {
    const deck = await db.decks.get(deckId)
    if (!deck?.deletedAt) continue
    const notes = await db.notes.where('deckId').equals(deckId).toArray()
    for (const n of notes) if (!n.deletedAt) noteIds.add(n.id)
  }
  for (const noteId of noteIds) {
    const note = await db.notes.get(noteId)
    if (!note) continue
    if (note.deletedAt) {
      const cards = await db.cards.where('noteId').equals(noteId).toArray()
      await db.cards.bulkPut(
        cards.filter((c) => !c.deletedAt).map((c) => ({ ...c, deletedAt: now, updatedAt: now })),
      )
      continue
    }
    const deck = await db.decks.get(note.deckId)
    if (deck?.deletedAt) await db.decks.put({ ...deck, deletedAt: null, updatedAt: now })
  }
}

/* ------------------------------------------------------------------ *
 * Transport und Verschlüsselung
 * ------------------------------------------------------------------ */

let keyCache: { key: string; keys: Promise<SyncKeys> } | null = null

function keysFor(key: string): Promise<SyncKeys> {
  if (keyCache?.key !== key) keyCache = { key, keys: deriveSyncKeys(key) }
  return keyCache.keys
}

const context = (r: { c: Collection; id: string; u: number }) => `${r.c}/${r.id}/${r.u}`

async function sealAll(key: CryptoKey, records: SyncRecord[]): Promise<WireRecord[]> {
  return Promise.all(
    records.map(async (r): Promise<WireRecord> =>
      r.del ? { c: r.c, id: r.id, u: r.u, del: true } : { c: r.c, id: r.id, u: r.u, d: await seal(key, context(r), r.d) },
    ),
  )
}

/**
 * Entschlüsseln. Ein Datensatz, der sich nicht öffnen lässt (beschädigt oder
 * manipuliert), wird übersprungen statt den ganzen Abgleich dauerhaft zu
 * blockieren — die Authentifizierung von AES-GCM stellt sicher, dass er
 * nicht stattdessen mit falschem Inhalt landet.
 */
async function openAll(key: CryptoKey, wire: WireRecord[]): Promise<SyncRecord[]> {
  const out: SyncRecord[] = []
  for (const w of wire) {
    if (!isCollection(w.c) || typeof w.id !== 'string' || typeof w.u !== 'number') continue
    if (w.del) {
      out.push({ c: w.c, id: w.id, u: w.u, del: true })
      continue
    }
    let d: SyncRecord['d']
    try {
      d = await unseal<SyncRecord['d']>(key, context(w), w.d ?? '')
    } catch {
      console.warn(`Sync: Datensatz ${w.c}/${w.id} lässt sich nicht entschlüsseln — übersprungen.`)
      continue
    }
    // Authentifiziert verschlüsselt heißt: von einem Gerät mit dem Schlüssel.
    // Die ID muss trotzdem passen, sonst stimmt etwas grundsätzlich nicht.
    if (!d || d.id !== w.id) continue
    out.push({ c: w.c, id: w.id, u: w.u, d })
  }
  return out
}

async function post<T>(keys: SyncKeys, path: 'pull' | 'push', body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${keys.token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new SyncError('offline', 'Keine Verbindung zum Sync-Server.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError('auth', data.error ?? 'Der Server hat den Sync-Schlüssel abgelehnt.')
  }
  if (!res.ok) throw new SyncError('server', data.error ?? `Sync-Server antwortet mit ${res.status}.`)
  return data as T
}
