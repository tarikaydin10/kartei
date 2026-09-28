// @vitest-environment node
/**
 * Zwei Geräte, ein Server — Ende zu Ende: echte Repository-Funktionen, echte
 * Engine, echter Server-Code (SQLite im Speicher), IndexedDB simuliert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { KarteiDB, db, useDatabaseForTests } from './db'
import {
  createDeck,
  createNote,
  cardsOfNote,
  deleteDeck,
  deleteNote,
  ensureSeed,
  listDecks,
  listNotes,
  recordReview,
  setSuspended,
  undoLastReview,
  updateNote,
} from './repo'
import { connectSync, loadSyncConfig, probeSyncKey, syncNow, SyncError } from './sync'
import { generateSyncKey } from '@/lib/crypto'
import { replay } from '@/domain/srs'
import { parseExportFile } from '@/io/schema'
import { importExportFile } from '@/io/importer'
import type { Card } from './types'

/* --- Server ----------------------------------------------------------- *
 * Der Server ist ein eigenes TypeScript-Programm (tsconfig.node.json) und
 * wird deshalb erst zur Laufzeit geladen.                                 */

interface Reply {
  status: number
  body: unknown
}
type Handle = (store: unknown, method: string, path: string, auth: string | undefined, body: string) => Reply

const serverDir = '../../server/'
const { SyncStore } = (await import(/* @vite-ignore */ `${serverDir}store.ts`)) as {
  SyncStore: new (db: unknown, maxSpaces: number) => unknown
}
const { handle } = (await import(/* @vite-ignore */ `${serverDir}app.ts`)) as { handle: Handle }
const sqlite = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ sqlite)) as {
  DatabaseSync: new (path: string) => unknown
}

let store: unknown

beforeEach(() => {
  store = new SyncStore(new DatabaseSync(':memory:'), 10)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url, 'http://kartei.test').pathname
    const headers = init.headers as Record<string, string>
    const reply = handle(store, init.method ?? 'GET', path, headers.authorization, String(init.body))
    return new Response(JSON.stringify(reply.body), { status: reply.status })
  })
})

/* --- Geräte ----------------------------------------------------------- */

let counter = 0
function device(): KarteiDB {
  counter++
  return new KarteiDB(`gerät-${counter}`, { indexedDB: new IDBFactory(), IDBKeyRange })
}

/** Auf einem Gerät arbeiten. */
async function on<T>(dev: KarteiDB, work: () => Promise<T>): Promise<T> {
  useDatabaseForTests(dev)
  return work()
}

async function review(cardId: string, rating: 1 | 2 | 3 | 4, at: number) {
  const card = (await db.cards.get(cardId))!
  return recordReview(
    { card, rating, verdict: 'manual', typed: '', durationMs: 1000, deviceId: db.name },
    at,
  )
}

/** Der Cache muss dem Log entsprechen — auf jedem Gerät, nach jedem Sync. */
async function expectCacheMatchesLog(cardId: string) {
  const card = (await db.cards.get(cardId))!
  const log = await db.reviews.where('cardId').equals(cardId).toArray()
  const expected = replay(card.createdAt, log)
  expect({ due: card.due, reps: card.reps, state: card.state, stability: card.stability }).toEqual({
    due: expected.due,
    reps: expected.reps,
    state: expected.state,
    stability: expected.stability,
  })
}

const T = Date.parse('2026-09-28T08:00:00Z')

const loadKey = async () => (await loadSyncConfig())?.key

async function setupTwo() {
  const key = generateSyncKey()
  const A = device()
  const B = device()
  const { deckId, noteId, cardId } = await on(A, async () => {
    const deck = await createDeck('Arbeit', { noteTypeId: 'concept' })
    const note = await createNote({
      deckId: deck.id,
      noteTypeId: 'concept',
      fields: { frage: 'Wo liegt der Datenzugriff?', antwort: 'In repo.ts.' },
    })
    const [card] = await cardsOfNote(note.id)
    await connectSync(key, { joining: false })
    await syncNow()
    return { deckId: deck.id, noteId: note.id, cardId: card!.id }
  })
  await on(B, async () => {
    await ensureSeed()
    const { exists } = await probeSyncKey(key)
    expect(exists).toBe(true)
    await connectSync(key, { joining: exists })
    await syncNow()
  })
  return { key, A, B, deckId, noteId, cardId }
}

/* --- Szenarien ------------------------------------------------------- */

describe('Sync zwischen zwei Geräten', () => {
  it('bringt Decks, Notizen und Karten auf das neue Gerät — ohne das leere Startdeck', async () => {
    const { B, deckId, noteId } = await setupTwo()
    await on(B, async () => {
      expect((await listDecks()).map((d) => d.id)).toEqual([deckId])
      expect((await listNotes(deckId)).map((n) => n.id)).toEqual([noteId])
      expect(await cardsOfNote(noteId)).toHaveLength(1)
    })
  })

  it('vereinigt Antworten beider Geräte und rechnet die Karte aus dem Log', async () => {
    const { A, B, cardId } = await setupTwo()
    await on(A, () => review(cardId, 3, T))
    await on(B, () => review(cardId, 1, T + 60_000))
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())

    for (const dev of [A, B]) {
      await on(dev, async () => {
        expect(await db.reviews.count()).toBe(2)
        await expectCacheMatchesLog(cardId)
        // Eingeschwungen: nichts mehr offen, in keine Richtung.
        expect(await syncNow()).toEqual({ pulled: 0, pushed: 0 })
      })
    }
    const dueA = await on(A, async () => (await db.cards.get(cardId))!.due)
    const dueB = await on(B, async () => (await db.cards.get(cardId))!.due)
    expect(dueA).toBe(dueB)
  })

  it('verteilt eine zurückgenommene Antwort als Löschung', async () => {
    const { A, B, cardId } = await setupTwo()
    await on(A, async () => {
      await review(cardId, 3, T)
      await syncNow()
    })
    await on(B, async () => {
      await syncNow()
      expect(await db.reviews.count()).toBe(1)
    })
    await on(A, async () => {
      await undoLastReview(cardId)
      expect((await syncNow())!.pushed).toBe(1)
      // Abgehakt: der Löschmarker geht nicht bei jedem Sync erneut raus.
      expect((await syncNow())!.pushed).toBe(0)
    })
    await on(B, async () => {
      await syncNow()
      expect(await db.reviews.count()).toBe(0)
      expect((await db.cards.get(cardId))!.state).toBe(0)
    })
    // Und B schickt sie nicht wieder hoch.
    await on(A, async () => {
      await syncNow()
      expect(await db.reviews.count()).toBe(0)
    })
  })

  it('bei gleichzeitiger Bearbeitung gewinnt die spätere, auf beiden Geräten', async () => {
    const { A, B, noteId } = await setupTwo()
    await on(A, () => updateNote(noteId, { fields: { frage: 'Frage A', antwort: 'A' } }))
    await new Promise((r) => setTimeout(r, 5))
    await on(B, () => updateNote(noteId, { fields: { frage: 'Frage B', antwort: 'B' } }))
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => expect((await db.notes.get(noteId))!.fields.frage).toBe('Frage B'))
    }
  })

  it('„Pausiert“ auf einem Gerät übersteht Antworten auf dem anderen', async () => {
    const { A, B, noteId, cardId } = await setupTwo()
    await on(B, () => setSuspended([noteId], true))
    await new Promise((r) => setTimeout(r, 5))
    await on(A, () => review(cardId, 3, Date.now()))
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => {
        const card = (await db.cards.get(cardId)) as Card
        expect(card.suspended).toBe(true)
        expect(card.reps).toBe(1)
      })
    }
  })

  it('dieselbe Datei auf beiden Geräten importiert ergibt ein Deck, keine Dubletten', async () => {
    const { A, B } = await setupTwo()
    const file = parseExportFile({
      decks: [{ name: 'Projektregeln' }],
      notes: [
        { fields: { frage: 'Warum nie hart löschen?', antwort: 'Wegen Sync.' } },
        { fields: { frage: 'Wer spricht mit Dexie?', antwort: 'Nur repo.ts.' } },
      ],
    })
    if (!file.ok) throw new Error(file.error)
    await on(A, () => importExportFile(file.file))
    await on(B, () => importExportFile(file.file))
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => {
        const decks = (await listDecks()).filter((d) => d.name === 'Projektregeln')
        expect(decks).toHaveLength(1)
        expect(await listNotes(decks[0]!.id)).toHaveLength(2)
        expect((await db.cards.toArray()).filter((c) => c.deckId === decks[0]!.id)).toHaveLength(2)
      })
    }
  })

  it('gelöscht auf A, später bearbeitet auf B: Notiz und Karten leben weiter', async () => {
    const { A, B, noteId } = await setupTwo()
    await on(A, () => deleteNote(noteId))
    await new Promise((r) => setTimeout(r, 5))
    await on(B, () => updateNote(noteId, { fields: { frage: 'Neu', antwort: 'Neu' } }))
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => {
        expect((await db.notes.get(noteId))!.deletedAt).toBeNull()
        expect(await cardsOfNote(noteId)).toHaveLength(1)
      })
    }
  })

  it('Notiz gelöscht, Karte auf dem anderen Gerät pausiert: die Karte geht mit', async () => {
    const { A, B, noteId, cardId } = await setupTwo()
    await on(A, () => deleteNote(noteId))
    await new Promise((r) => setTimeout(r, 5))
    await on(B, () => setSuspended([noteId], true))
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => {
        expect((await db.notes.get(noteId))!.deletedAt).not.toBeNull()
        expect((await db.cards.get(cardId))!.deletedAt).not.toBeNull()
      })
    }
  })

  it('Deck gelöscht, auf dem anderen Gerät neue Notiz: das Deck kommt zurück', async () => {
    const { A, B, deckId } = await setupTwo()
    await on(A, () => deleteDeck(deckId))
    await new Promise((r) => setTimeout(r, 5))
    const fresh = await on(B, () =>
      createNote({ deckId, noteTypeId: 'concept', fields: { frage: 'Neu?', antwort: 'Ja.' } }),
    )
    await on(A, () => syncNow())
    await on(B, () => syncNow())
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => {
        expect((await listDecks()).map((d) => d.id)).toContain(deckId)
        expect((await listNotes(deckId)).map((n) => n.id)).toEqual([fresh.id])
      })
    }
  })

  it('füllt einen zurückgesetzten Server wieder auf', async () => {
    const { A, B, cardId } = await setupTwo()
    await on(A, async () => {
      await review(cardId, 3, T)
      await syncNow()
    })
    await on(B, () => syncNow())

    store = new SyncStore(new DatabaseSync(':memory:'), 10) // Server verliert alles
    await on(A, () => syncNow())
    await on(B, () => syncNow())

    const C = device()
    await on(C, async () => {
      await connectSync((await on(A, loadKey))!, { joining: true })
      await syncNow()
      expect(await db.notes.count()).toBe(1)
      expect(await db.reviews.count()).toBe(1)
      await expectCacheMatchesLog(cardId)
    })
    // Und A und B sind danach wieder eingeschwungen.
    for (const dev of [A, B]) await on(dev, async () => expect(await syncNow()).toEqual({ pulled: 0, pushed: 0 }))
  })

  it('neu verbinden löscht keine schon synchronisierten Decks — auch leere nicht', async () => {
    const { A, B, deckId, noteId } = await setupTwo()
    // Die einzige Notiz wird gelöscht: B hat danach keine lebende Notiz mehr.
    await on(A, async () => {
      await deleteNote(noteId)
      await syncNow()
    })
    await on(B, () => syncNow())
    await on(B, async () => {
      await connectSync((await on(A, loadKey))!, { joining: true })
      await syncNow()
    })
    await on(A, () => syncNow())
    for (const dev of [A, B]) {
      await on(dev, async () => expect((await listDecks()).map((d) => d.id)).toContain(deckId))
    }
  })

  it('hält an, statt einen lokalen Datenverlust zu verteilen', async () => {
    const { A, B, cardId } = await setupTwo()
    await on(A, async () => {
      for (let i = 0; i < 40; i++) await review(cardId, 3, T + i * 86_400_000)
      await syncNow()
    })
    await on(B, () => syncNow())
    await on(A, async () => {
      await db.reviews.clear()
      await expect(syncNow()).rejects.toBeInstanceOf(SyncError)
    })
    await on(B, async () => {
      await syncNow()
      expect(await db.reviews.count()).toBe(40)
    })
  })
})

describe('Migration auf v2', () => {
  it('gibt bestehenden Karten die ID aus Notiz × Richtung und nimmt die Reviews mit', async () => {
    const factory = new IDBFactory()
    const { default: Dexie } = await import('dexie')
    const old = new Dexie('alt', { indexedDB: factory, IDBKeyRange })
    old.version(1).stores({
      decks: 'id, sortOrder, updatedAt',
      notes: 'id, deckId, noteTypeId, updatedAt, *tags',
      cards: 'id, noteId, deckId, due, state, updatedAt, [deckId+state], [deckId+due]',
      reviews: 'id, cardId, noteId, deckId, ts',
      settings: 'key',
    })
    await old.table('cards').add({ id: 'zufall-1', noteId: 'n1', templateId: 'ru2de', deckId: 'd1', createdAt: T })
    await old.table('reviews').add({ id: 'r1', cardId: 'zufall-1', noteId: 'n1', deckId: 'd1', ts: T, rating: 3 })
    old.close()

    const migrated = new KarteiDB('alt', { indexedDB: factory, IDBKeyRange })
    expect((await migrated.cards.toArray()).map((c) => c.id)).toEqual(['n1:ru2de'])
    expect((await migrated.reviews.get('r1'))!.cardId).toBe('n1:ru2de')
  })
})
