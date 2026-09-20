/**
 * Repository-Schicht. Alles, was an die Datenbank geht, geht hier durch —
 * die UI spricht nie direkt mit Dexie. So kann später ein Sync-Backend hinter
 * dieselbe Schnittstelle, ohne dass ein einziges Component angefasst wird.
 *
 * Jede Schreiboperation stempelt `updatedAt`. Gelöscht wird ausschließlich
 * weich (`deletedAt`), damit Löschungen später synchronisierbar sind.
 */
import { db } from './db'
import { newId } from '@/lib/id'
import { dayKey, startOfDay } from '@/lib/date'
import { defaultTemplateIds, noteType } from '@/domain/notetypes'
import { applyRating, initialState, replay, type SrsState } from '@/domain/srs'
import { buildQueue } from '@/domain/session'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Card,
  type Deck,
  type ID,
  type Note,
  type NoteTypeId,
  type Rating,
  type Review,
} from './types'

/* ------------------------------------------------------------------ *
 * Helfer
 * ------------------------------------------------------------------ */

function live<T extends { deletedAt: number | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt)
}

export function cardState(card: Card): SrsState {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    state: card.state,
    learningSteps: card.learningSteps,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview,
  }
}

/* ------------------------------------------------------------------ *
 * Einstellungen
 * ------------------------------------------------------------------ */

/** Reiner Lesezugriff — damit der Aufruf in einer liveQuery nichts schreibt. */
export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray()
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value
  return out as unknown as AppSettings
}

/** Einmal beim Start. Die Geräte-ID landet später in jedem Review. */
export async function ensureDeviceId(): Promise<string> {
  const row = await db.settings.get('deviceId')
  if (typeof row?.value === 'string' && row.value) return row.value
  const id = newId()
  await saveSetting('deviceId', id)
  return id
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() })
}

/* ------------------------------------------------------------------ *
 * Decks
 * ------------------------------------------------------------------ */

export async function listDecks(): Promise<Deck[]> {
  const rows = await db.decks.toArray()
  return live(rows).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'))
}

export async function getDeck(id: ID): Promise<Deck | undefined> {
  return db.decks.get(id)
}

export async function createDeck(
  name: string,
  opts: { emoji?: string; noteTypeId?: NoteTypeId; newPerDay?: number } = {},
): Promise<Deck> {
  const now = Date.now()
  const existing = await db.decks.toArray()
  const deck: Deck = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: name.trim() || 'Neues Deck',
    emoji: opts.emoji ?? '🗂️',
    noteTypeId: opts.noteTypeId ?? 'ru-vocab',
    newPerDay: opts.newPerDay ?? 0,
    sortOrder: existing.length,
  }
  await db.decks.add(deck)
  return deck
}

export async function updateDeck(id: ID, patch: Partial<Omit<Deck, 'id' | 'createdAt'>>): Promise<void> {
  await db.decks.update(id, { ...patch, updatedAt: Date.now() })
}

/** Weiches Löschen, kaskadiert auf Notizen und Karten. */
export async function deleteDeck(id: ID): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.decks, db.notes, db.cards, async () => {
    await db.decks.update(id, { deletedAt: now, updatedAt: now })
    const notes = await db.notes.where('deckId').equals(id).toArray()
    await db.notes.bulkPut(notes.map((n) => ({ ...n, deletedAt: now, updatedAt: now })))
    const cards = await db.cards.where('deckId').equals(id).toArray()
    await db.cards.bulkPut(cards.map((c) => ({ ...c, deletedAt: now, updatedAt: now })))
  })
}

export async function reorderDecks(idsInOrder: ID[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.decks, async () => {
    for (let i = 0; i < idsInOrder.length; i++) {
      await db.decks.update(idsInOrder[i]!, { sortOrder: i, updatedAt: now })
    }
  })
}

/**
 * Erststart: ein Deck, damit nie ein leerer Bildschirm ohne nächsten Schritt
 * steht. Prüfen und Anlegen müssen in *einer* Transaktion passieren — sonst
 * legen zwei parallele Aufrufe (React StrictMode, zwei offene Tabs) zwei Decks
 * an.
 */
export async function ensureSeed(): Promise<Deck> {
  return db.transaction('rw', db.decks, async () => {
    const existing = live(await db.decks.toArray())
    if (existing.length > 0) {
      return existing.sort((a, b) => a.sortOrder - b.sortOrder)[0]!
    }
    const now = Date.now()
    const deck: Deck = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      name: 'Russisch',
      emoji: '🇷🇺',
      noteTypeId: 'ru-vocab',
      newPerDay: 0,
      sortOrder: 0,
    }
    await db.decks.add(deck)
    return deck
  })
}

/* ------------------------------------------------------------------ *
 * Notizen und Karten
 * ------------------------------------------------------------------ */

export interface NoteInput {
  deckId: ID
  noteTypeId: NoteTypeId
  fields: Record<string, string>
  tags?: string[]
  templateIds?: string[]
}

export async function listNotes(deckId?: ID | null): Promise<Note[]> {
  const rows = deckId ? await db.notes.where('deckId').equals(deckId).toArray() : await db.notes.toArray()
  return live(rows).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getNote(id: ID): Promise<Note | undefined> {
  return db.notes.get(id)
}

export async function cardsOfNote(noteId: ID): Promise<Card[]> {
  return live(await db.cards.where('noteId').equals(noteId).toArray())
}

export async function createNote(input: NoteInput): Promise<Note> {
  const now = Date.now()
  const note: Note = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deckId: input.deckId,
    noteTypeId: input.noteTypeId,
    fields: normalizeFields(input.noteTypeId, input.fields),
    tags: dedupeTags(input.tags),
  }
  const templateIds = input.templateIds ?? defaultTemplateIds(input.noteTypeId)
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.add(note)
    await reconcileCards(note, templateIds, now)
  })
  return note
}

export async function updateNote(
  id: ID,
  patch: {
    fields?: Record<string, string>
    tags?: string[]
    deckId?: ID
    templateIds?: string[]
  },
): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.cards, async () => {
    const note = await db.notes.get(id)
    if (!note) return
    const next: Note = {
      ...note,
      fields: patch.fields ? normalizeFields(note.noteTypeId, patch.fields) : note.fields,
      tags: patch.tags ? dedupeTags(patch.tags) : note.tags,
      deckId: patch.deckId ?? note.deckId,
      updatedAt: now,
    }
    await db.notes.put(next)

    if (patch.deckId && patch.deckId !== note.deckId) {
      const cards = await db.cards.where('noteId').equals(id).toArray()
      await db.cards.bulkPut(cards.map((c) => ({ ...c, deckId: patch.deckId!, updatedAt: now })))
    }
    if (patch.templateIds) await reconcileCards(next, patch.templateIds, now)
  })
}

export async function deleteNote(id: ID): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.update(id, { deletedAt: now, updatedAt: now })
    const cards = await db.cards.where('noteId').equals(id).toArray()
    await db.cards.bulkPut(cards.map((c) => ({ ...c, deletedAt: now, updatedAt: now })))
  })
}

export async function deleteNotes(ids: ID[]): Promise<void> {
  for (const id of ids) await deleteNote(id)
}

export async function moveNotes(ids: ID[], deckId: ID): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.cards, async () => {
    const notes = await db.notes.bulkGet(ids)
    for (const note of notes) {
      if (!note) continue
      await db.notes.put({ ...note, deckId, updatedAt: now })
      const cards = await db.cards.where('noteId').equals(note.id).toArray()
      await db.cards.bulkPut(cards.map((c) => ({ ...c, deckId, updatedAt: now })))
    }
  })
}

export async function setSuspended(noteIds: ID[], suspended: boolean): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.cards, async () => {
    for (const noteId of noteIds) {
      const cards = await db.cards.where('noteId').equals(noteId).toArray()
      await db.cards.bulkPut(cards.map((c) => ({ ...c, suspended, updatedAt: now })))
    }
  })
}

function normalizeFields(id: NoteTypeId, fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of noteType(id).fields) out[f.key] = (fields[f.key] ?? '').trim()
  return out
}

function dedupeTags(tags?: string[]): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim().toLowerCase()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/**
 * Karten an die gewünschten Vorlagen anpassen.
 * Eine abgewählte und später wieder gewählte Richtung behält ihren Verlauf —
 * deshalb wird eine weich gelöschte Karte reaktiviert statt neu angelegt.
 */
async function reconcileCards(note: Note, templateIds: string[], now: number): Promise<void> {
  const wanted = new Set(templateIds.length ? templateIds : defaultTemplateIds(note.noteTypeId))
  const existing = await db.cards.where('noteId').equals(note.id).toArray()
  const byTemplate = new Map(existing.map((c) => [c.templateId, c]))

  for (const templateId of wanted) {
    const found = byTemplate.get(templateId)
    if (!found) {
      await db.cards.add({
        id: newId(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        noteId: note.id,
        deckId: note.deckId,
        templateId,
        suspended: false,
        ...initialState(now),
      })
    } else if (found.deletedAt) {
      await db.cards.put({ ...found, deletedAt: null, deckId: note.deckId, updatedAt: now })
    }
  }

  for (const card of existing) {
    if (!wanted.has(card.templateId) && !card.deletedAt) {
      await db.cards.put({ ...card, deletedAt: now, updatedAt: now })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Lernen
 * ------------------------------------------------------------------ */

export interface StudyCard {
  card: Card
  note: Note
}

export interface DeckCounts {
  due: number
  fresh: number
  learning: number
  total: number
}

async function liveCards(deckId?: ID | null): Promise<Card[]> {
  const rows = deckId ? await db.cards.where('deckId').equals(deckId).toArray() : await db.cards.toArray()
  return live(rows).filter((c) => !c.suspended)
}

export async function countsFor(deckId?: ID | null, now = Date.now()): Promise<DeckCounts> {
  const cards = await liveCards(deckId)
  let due = 0
  let fresh = 0
  let learning = 0
  for (const c of cards) {
    if (c.state === 0) fresh++
    else if (c.due <= now) due++
    if (c.state === 1 || c.state === 3) learning++
  }
  return { due, fresh, learning, total: cards.length }
}

export async function countsByDeck(now = Date.now()): Promise<Map<ID, DeckCounts>> {
  const cards = live(await db.cards.toArray()).filter((c) => !c.suspended)
  const map = new Map<ID, DeckCounts>()
  for (const c of cards) {
    let e = map.get(c.deckId)
    if (!e) {
      e = { due: 0, fresh: 0, learning: 0, total: 0 }
      map.set(c.deckId, e)
    }
    e.total++
    if (c.state === 0) e.fresh++
    else if (c.due <= now) e.due++
    if (c.state === 1 || c.state === 3) e.learning++
  }
  return map
}

/** Wie viele neue Karten heute schon eingeführt wurden. */
export async function newIntroducedToday(now = Date.now()): Promise<number> {
  const from = startOfDay(now)
  const rows = await db.reviews.where('ts').aboveOrEqual(from).toArray()
  const ids = new Set<ID>()
  for (const r of rows) if (r.wasNew) ids.add(r.cardId)
  return ids.size
}

export async function buildSession(
  deckId: ID | null,
  settings: AppSettings,
  overrides: { size?: number } = {},
): Promise<StudyCard[]> {
  const now = Date.now()
  const size = overrides.size ?? settings.sessionSize
  const cards = await liveCards(deckId)

  const deck = deckId ? await getDeck(deckId) : undefined
  const perDay = deck?.newPerDay && deck.newPerDay > 0 ? deck.newPerDay : settings.newPerDay
  const introduced = await newIntroducedToday(now)
  const newLimit = Math.max(0, perDay - introduced)

  const due = cards.filter((c) => c.state !== 0 && c.due <= now)
  const fresh = cards.filter((c) => c.state === 0)
  const queue = buildQueue(due, fresh, { size, newLimit, now })

  const notes = await db.notes.bulkGet([...new Set(queue.map((c) => c.noteId))])
  const noteById = new Map<ID, Note>()
  for (const n of notes) if (n && !n.deletedAt) noteById.set(n.id, n)

  return queue
    .map((card) => {
      const note = noteById.get(card.noteId)
      return note ? { card, note } : null
    })
    .filter((x): x is StudyCard => x !== null)
}

export interface ReviewInput {
  card: Card
  rating: Rating
  verdict: Review['verdict']
  typed: string
  durationMs: number
  deviceId: string
}

/** Review anfügen und den abgeleiteten Kartenzustand fortschreiben — atomar. */
export async function recordReview(input: ReviewInput, now = Date.now()): Promise<Card> {
  const { card, rating } = input
  const next = applyRating(cardState(card), rating, now)
  const updated: Card = { ...card, ...next, updatedAt: now }

  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.put(updated)
    await db.reviews.add({
      id: newId(),
      cardId: card.id,
      noteId: card.noteId,
      deckId: card.deckId,
      ts: now,
      rating,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      typed: input.typed,
      verdict: input.verdict,
      wasNew: card.state === 0,
      deviceId: input.deviceId,
    })
  })
  return updated
}

/**
 * Letzte Antwort einer Karte zurücknehmen und den Zustand aus dem restlichen
 * Log neu berechnen.
 *
 * Bewusste Ausnahme von „Reviews sind unveränderlich“: das passiert Sekunden
 * nach der Eingabe, lange vor jedem Sync. Ein Verkliker ohne Ausweg kostet
 * mehr Vertrauen als diese Ausnahme.
 */
export async function undoLastReview(cardId: ID): Promise<Card | undefined> {
  return db.transaction('rw', db.cards, db.reviews, async () => {
    const card = await db.cards.get(cardId)
    if (!card) return undefined
    const reviews = await db.reviews.where('cardId').equals(cardId).toArray()
    if (reviews.length === 0) return card
    reviews.sort((a, b) => a.ts - b.ts)
    const last = reviews.pop()!
    await db.reviews.delete(last.id)
    const state = replay(card.createdAt, reviews)
    const restored: Card = { ...card, ...state, updatedAt: Date.now() }
    await db.cards.put(restored)
    return restored
  })
}

/* ------------------------------------------------------------------ *
 * Statistik
 * ------------------------------------------------------------------ */

export async function allReviews(): Promise<Review[]> {
  return db.reviews.orderBy('ts').toArray()
}

export async function reviewsSince(ts: number): Promise<Review[]> {
  return db.reviews.where('ts').aboveOrEqual(ts).toArray()
}

export async function reviewsToday(now = Date.now()): Promise<Review[]> {
  return db.reviews.where('ts').aboveOrEqual(startOfDay(now)).toArray()
}

/** Fälligkeitsvorschau: wie viele Karten an den nächsten `days` Tagen anstehen. */
export async function dueForecast(days = 14, now = Date.now()): Promise<number[]> {
  const cards = await liveCards(null)
  const out = Array.from<number>({ length: days }).fill(0)
  const today = startOfDay(now)
  for (const c of cards) {
    if (c.state === 0) continue
    const idx = Math.floor((startOfDay(c.due) - today) / 86_400_000)
    if (idx < 0) out[0]!++
    else if (idx < days) out[idx]!++
  }
  return out
}

export interface Totals {
  notes: number
  cards: number
  reviews: number
  mature: number
  young: number
  fresh: number
}

export async function totals(): Promise<Totals> {
  const [notes, cards, reviews] = await Promise.all([
    db.notes.toArray(),
    db.cards.toArray(),
    db.reviews.count(),
  ])
  const alive = live(cards)
  let mature = 0
  let young = 0
  let fresh = 0
  for (const c of alive) {
    if (c.state === 0) fresh++
    else if (c.scheduledDays >= 21) mature++
    else young++
  }
  return { notes: live(notes).length, cards: alive.length, reviews, mature, young, fresh }
}

/** Tagesschlüssel der Reviews — Grundlage für Streak und Heatmap. */
export async function reviewDayKeys(): Promise<string[]> {
  const rows = await db.reviews.orderBy('ts').toArray()
  return rows.map((r) => dayKey(r.ts))
}
