import Dexie, { type DexieOptions, type Table } from 'dexie'
import { cardIdFor } from '@/lib/id'
import { replay } from '@/domain/srs'
import type { Card, Deck, Note, Review, StoredSetting, SyncedVersion } from './types'

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
  /** Was der Server von jedem Datensatz zuletzt bestätigt hat (siehe sync.ts). */
  synced!: Table<SyncedVersion, string>

  constructor(name = 'kartei', options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      decks: 'id, sortOrder, updatedAt',
      notes: 'id, deckId, noteTypeId, updatedAt, *tags',
      cards: 'id, noteId, deckId, due, state, updatedAt, [deckId+state], [deckId+due]',
      reviews: 'id, cardId, noteId, deckId, ts',
      settings: 'key',
    })

    /*
     * v2 — Sync. Karten bekommen die ID aus Notiz × Richtung (`cardIdFor`),
     * damit zwei Geräte für dieselbe Notiz dieselbe Karte haben; die Reviews
     * ziehen mit. Sollte es je zwei Karten derselben Richtung gegeben haben,
     * werden sie vereinigt und aus dem gemeinsamen Log neu berechnet.
     */
    this.version(2)
      .stores({ synced: 'k' })
      .upgrade(async (tx) => {
        const cards = tx.table<Card, string>('cards')
        const reviews = tx.table<Review, string>('reviews')
        const merged = new Set<string>()
        for (const card of await cards.toArray()) {
          const id = cardIdFor(card.noteId, card.templateId)
          if (id === card.id) continue
          await reviews.where('cardId').equals(card.id).modify({ cardId: id })
          await cards.delete(card.id)
          const clash = await cards.get(id)
          if (!clash) {
            await cards.add({ ...card, id })
          } else {
            merged.add(id)
            // Die lebende Karte gewinnt.
            if (clash.deletedAt && !card.deletedAt) await cards.put({ ...card, id })
          }
        }
        for (const id of merged) {
          const card = await cards.get(id)
          if (!card) continue
          const log = await reviews.where('cardId').equals(id).toArray()
          await cards.put({ ...card, ...replay(card.createdAt, log) })
        }
      })
  }
}

export let db = new KarteiDB()

/**
 * Nur für Tests: die Datenbank austauschen, um zwei Geräte gegeneinander
 * synchronisieren zu lassen. ES-Module binden live — alle Importeure sehen
 * danach die neue.
 */
export function useDatabaseForTests(next: KarteiDB): void {
  db = next
}
