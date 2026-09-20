import { describe, expect, it } from 'vitest'
import { buildQueue, interleave, requeue } from './session'
import type { Card } from '@/data/types'

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    createdAt: Number(id.replace(/\D/g, '')) || 0,
    updatedAt: 0,
    deletedAt: null,
    noteId: `n${id}`,
    deckId: 'd1',
    templateId: 'ru2de',
    suspended: false,
    due: 0,
    stability: 0,
    difficulty: 0,
    state: 2,
    learningSteps: 0,
    scheduledDays: 0,
    reps: 1,
    lapses: 0,
    lastReview: null,
    ...over,
  }
}

const dueCards = (n: number) => Array.from({ length: n }, (_, i) => card(`r${i}`, { due: i }))
const newCards = (n: number) => Array.from({ length: n }, (_, i) => card(`n${i}`, { state: 0, reps: 0 }))

describe('buildQueue', () => {
  it('hält die Sessiongröße ein', () => {
    const q = buildQueue(dueCards(50), newCards(50), { size: 20, newLimit: 10 })
    expect(q).toHaveLength(20)
  })

  it('nimmt die am längsten fälligen Karten zuerst', () => {
    const q = buildQueue(dueCards(10), [], { size: 5, newLimit: 0 })
    expect(q.map((c) => c.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('reserviert auch bei Rückstand Plätze für neue Karten', () => {
    const q = buildQueue(dueCards(200), newCards(20), { size: 20, newLimit: 10 })
    const fresh = q.filter((c) => c.state === 0)
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.length).toBeLessThanOrEqual(6)
  })

  it('füllt mit neuen Karten auf, wenn wenig fällig ist', () => {
    const q = buildQueue(dueCards(2), newCards(30), { size: 20, newLimit: 15 })
    expect(q).toHaveLength(17)
    expect(q.filter((c) => c.state === 0)).toHaveLength(15)
  })

  it('respektiert das Tageslimit für neue Karten', () => {
    const q = buildQueue([], newCards(30), { size: 20, newLimit: 3 })
    expect(q).toHaveLength(3)
  })

  it('liefert eine leere Schlange, wenn es nichts zu tun gibt', () => {
    expect(buildQueue([], [], { size: 20, newLimit: 10 })).toEqual([])
  })

  it('erzeugt keine Duplikate', () => {
    const q = buildQueue(dueCards(30), newCards(30), { size: 20, newLimit: 6 })
    expect(new Set(q.map((c) => c.id)).size).toBe(q.length)
  })
})

describe('interleave', () => {
  it('beginnt mit Wiederholungen als Aufwärmen', () => {
    const q = interleave(dueCards(6), newCards(3))
    expect(q[0]!.state).toBe(2)
    expect(q[1]!.state).toBe(2)
  })

  it('behält alle Karten', () => {
    const q = interleave(dueCards(7), newCards(4))
    expect(q).toHaveLength(11)
    expect(new Set(q.map((c) => c.id)).size).toBe(11)
  })

  it('verteilt neue Karten, statt sie zu bündeln', () => {
    const q = interleave(dueCards(9), newCards(3))
    const positions = q.map((c, i) => (c.state === 0 ? i : -1)).filter((i) => i >= 0)
    const gaps = positions.slice(1).map((p, i) => p - positions[i]!)
    expect(Math.min(...gaps)).toBeGreaterThan(1)
  })

  it('funktioniert mit nur einer Sorte', () => {
    expect(interleave(dueCards(3), [])).toHaveLength(3)
    expect(interleave([], newCards(3))).toHaveLength(3)
  })
})

describe('requeue', () => {
  it('schiebt die Karte hinter die nächsten drei', () => {
    const q = ['a', 'b', 'c', 'd', 'e']
    expect(requeue(q, 0, 3)).toEqual(['a', 'b', 'c', 'd', 'a', 'e'])
  })

  it('hängt sie ans Ende, wenn nicht genug Karten folgen', () => {
    expect(requeue(['a', 'b'], 0, 3)).toEqual(['a', 'b', 'a'])
  })

  it('lässt die Schlange bei ungültiger Position unverändert', () => {
    const q = ['a']
    expect(requeue(q, 5)).toBe(q)
  })
})
