import { describe, expect, it } from 'vitest'
import { cardMeta, looksLikeDataLoss, pendingChanges, remoteApplies, syncKey, tombstoneVersion } from './sync'
import { initialState } from './srs'
import type { Card, Deck, Note } from '@/data/types'

const T = Date.parse('2026-09-28T10:00:00Z')

const deck = (id: string, u = T): Deck => ({
  id,
  createdAt: T,
  updatedAt: u,
  deletedAt: null,
  name: id,
  emoji: '🗂️',
  noteTypeId: 'concept',
  newPerDay: 0,
  sortOrder: 0,
})

const note = (id: string, u = T): Note => ({
  id,
  createdAt: T,
  updatedAt: u,
  deletedAt: null,
  deckId: 'd1',
  noteTypeId: 'concept',
  fields: { frage: 'F', antwort: 'A' },
  tags: [],
})

const card = (id: string, u = T): Card => ({
  id,
  createdAt: T,
  updatedAt: u,
  deletedAt: null,
  noteId: 'n1',
  deckId: 'd1',
  templateId: 'q2a',
  suspended: false,
  ...initialState(T),
})

describe('remoteApplies', () => {
  it('übernimmt Unbekanntes und Neueres', () => {
    expect(remoteApplies(T, undefined)).toBe(true)
    expect(remoteApplies(T + 1, T)).toBe(true)
  })

  it('übernimmt bei Gleichstand den Server', () => {
    expect(remoteApplies(T, T)).toBe(true)
  })

  it('behält eine neuere lokale Fassung — sie geht beim Senden raus', () => {
    expect(remoteApplies(T, T + 1)).toBe(false)
  })
})

describe('pendingChanges', () => {
  it('sendet alles, was der Server nicht bestätigt hat', () => {
    const p = pendingChanges({
      decks: [deck('d1')],
      notes: [note('n1')],
      cards: [card('c1')],
      reviewIds: ['r1'],
      synced: new Map(),
    })
    expect(p.records.map((r) => syncKey(r.c, r.id))).toEqual(['decks/d1', 'notes/n1', 'cards/c1'])
    expect(p.newReviewIds).toEqual(['r1'])
    expect(p.deletedReviews).toEqual([])
  })

  it('lässt Bestätigtes weg und erkennt Änderungen an der Version', () => {
    const p = pendingChanges({
      decks: [deck('d1')],
      notes: [note('n1', T + 5)],
      cards: [card('c1')],
      reviewIds: ['r1'],
      synced: new Map([
        ['decks/d1', T],
        ['notes/n1', T],
        ['cards/c1', T],
        ['reviews/r1', T],
      ]),
    })
    expect(p.records.map((r) => r.id)).toEqual(['n1'])
    expect(p.newReviewIds).toEqual([])
  })

  it('meldet zurückgenommene Reviews als gelöscht', () => {
    const p = pendingChanges({
      decks: [],
      notes: [],
      cards: [],
      reviewIds: ['r1'],
      synced: new Map([
        ['reviews/r1', T],
        ['reviews/r2', T + 7],
      ]),
    })
    expect(p.deletedReviews).toEqual([{ id: 'r2', u: T + 7 }])
  })

  it('schickt von Karten nur Zuordnung und Status, nicht den FSRS-Cache', () => {
    const p = pendingChanges({ decks: [], notes: [], cards: [card('c1')], reviewIds: [], synced: new Map() })
    expect(p.records[0]!.d).toEqual(cardMeta(card('c1')))
    expect(p.records[0]!.d).not.toHaveProperty('stability')
  })
})

describe('tombstoneVersion', () => {
  it('ist jetzt — oder jünger als das Review, falls die Uhr nachgeht', () => {
    expect(tombstoneVersion(T, T + 1000)).toBe(T + 1000)
    expect(tombstoneVersion(T + 5000, T)).toBe(T + 5001)
  })
})

describe('looksLikeDataLoss', () => {
  it('lässt einzelne Rücknahmen durch', () => {
    expect(looksLikeDataLoss(1, 10)).toBe(false)
    expect(looksLikeDataLoss(3, 5000)).toBe(false)
  })

  it('hält an, wenn ein großer Teil fehlt', () => {
    expect(looksLikeDataLoss(5000, 5000)).toBe(true)
    expect(looksLikeDataLoss(600, 5000)).toBe(true)
  })
})
