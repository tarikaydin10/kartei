import Dexie, { type Table } from 'dexie'
import type { Card, Deck, Note, Review, StoredSetting } from './types'

/**
 * IndexedDB via Dexie. Schema-Änderungen nur additiv und immer als neue
 * `version()` — nie eine bestehende Migration umschreiben.
 *
 * Hinweis zu Soft-Deletes: IndexedDB indiziert `null` nicht, `deletedAt` ist
 * deshalb kein Filterindex. Gelöschte Datensätze werden in der Repository-
 * Schicht in JS herausgefiltert (siehe repo.ts). Bei den erwarteten
 * Datenmengen (Tausende Karten) ist das völlig unkritisch und spart ein
 * redundantes Flag, das driften könnte.
 */
export class KarteiDB extends Dexie {
  decks!: Table<Deck, string>
  notes!: Table<Note, string>
  cards!: Table<Card, string>
  reviews!: Table<Review, string>
  settings!: Table<StoredSetting, string>

  constructor() {
    super('kartei')
    this.version(1).stores({
      decks: 'id, sortOrder, updatedAt',
      notes: 'id, deckId, noteTypeId, updatedAt, *tags',
      cards: 'id, noteId, deckId, due, state, updatedAt, [deckId+state], [deckId+due]',
      reviews: 'id, cardId, noteId, deckId, ts',
      settings: 'key',
    })
  }
}

export const db = new KarteiDB()
