import { describe, expect, it } from 'vitest'
import {
  buildQueue,
  hardness,
  interleave,
  pickCards,
  poolCounts,
  requeue,
  shuffle,
  type PickContext,
} from './session'
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

/** Deterministischer Zufall für reproduzierbare Tests. */
function seeded(seed = 42): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const NOW = 1_000_000

function ctx(over: Partial<PickContext> = {}): PickContext {
  return { now: NOW, newLimit: 10, todayIds: new Set(), misses: new Map(), rng: seeded(), ...over }
}

describe('pickCards', () => {
  const pool = [
    card('a1', { due: NOW + 3000 }),
    card('a2', { due: NOW + 1000 }),
    card('a3', { due: NOW + 2000 }),
    card('d1', { due: NOW - 10 }),
    card('n1', { state: 0, reps: 0, createdAt: 2 }),
    card('n2', { state: 0, reps: 0, createdAt: 1 }),
    card('s1', { due: NOW + 500, suspended: true }),
  ]

  it('due entspricht dem Tagesplan', () => {
    const q = pickCards('due', pool, 20, ctx({ newLimit: 1 }))
    expect(q.map((c) => c.id)).toEqual(['d1', 'n2'])
  })

  it('ahead nimmt die nächsten noch nicht fälligen Karten', () => {
    const q = pickCards('ahead', pool, 2, ctx())
    expect(q.map((c) => c.id)).toEqual(['a2', 'a3'])
  })

  it('ahead lässt neue, fällige und gesperrte Karten weg', () => {
    const ids = pickCards('ahead', pool, 20, ctx()).map((c) => c.id)
    expect(ids).not.toContain('d1')
    expect(ids).not.toContain('n1')
    expect(ids).not.toContain('s1')
  })

  it('new ignoriert das Tageslimit und nimmt die ältesten zuerst', () => {
    const q = pickCards('new', pool, 20, ctx({ newLimit: 0 }))
    expect(q.map((c) => c.id)).toEqual(['n2', 'n1'])
  })

  it('today nimmt nur heute beantwortete, bekannte Karten', () => {
    const q = pickCards('today', pool, 20, ctx({ todayIds: new Set(['a1', 'd1', 'n1', 's1']) }))
    expect(q.map((c) => c.id).sort()).toEqual(['a1', 'd1'])
  })

  it('hard wählt nach Schwierigkeit und lässt leichte weg', () => {
    const cards = [
      card('e1', { difficulty: 2 }),
      card('h1', { lapses: 3 }),
      card('h2', { difficulty: 6 }),
      card('h3', { difficulty: 3 }),
    ]
    const q = pickCards('hard', cards, 2, ctx({ misses: new Map([['h3', 1]]) }))
    expect(q.map((c) => c.id).sort()).toEqual(['h1', 'h3'])
  })

  it('random nimmt nur bekannte Karten und hält die Größe ein', () => {
    const q = pickCards('random', pool, 3, ctx())
    expect(q).toHaveLength(3)
    expect(q.every((c) => c.state !== 0 && !c.suspended)).toBe(true)
  })

  it('repeat nimmt genau die gewünschten Karten, auch neue', () => {
    const q = pickCards('repeat', pool, 1, ctx({ cardIds: ['a1', 'n1', 'fehlt'] }))
    expect(q.map((c) => c.id).sort()).toEqual(['a1', 'n1'])
  })
})

describe('poolCounts', () => {
  it('zählt je Modus, ohne gesperrte Karten', () => {
    const cards = [
      card('a', { due: NOW + 1 }),
      card('b', { due: NOW - 1, lapses: 1 }),
      card('c', { state: 0, reps: 0 }),
      card('d', { due: NOW + 1, suspended: true }),
    ]
    expect(poolCounts(cards, { now: NOW, todayIds: new Set(['a']), misses: new Map() })).toEqual({
      ahead: 1,
      fresh: 1,
      today: 1,
      hard: 1,
      known: 2,
    })
  })
})

describe('hardness', () => {
  it('ist 0 für neue und unauffällige Karten', () => {
    expect(hardness(card('x', { state: 0, lapses: 5 }))).toBe(0)
    expect(hardness(card('x', { difficulty: 3 }))).toBe(0)
  })

  it('steigt mit Rückfällen und frischen Fehlern', () => {
    const base = card('x', { difficulty: 3 })
    expect(hardness(base, 1)).toBeGreaterThan(0)
    expect(hardness({ ...base, lapses: 2 }, 1)).toBeGreaterThan(hardness(base, 1))
  })
})

describe('shuffle', () => {
  it('behält alle Elemente und lässt die Eingabe unverändert', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const out = shuffle(input, seeded(7))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('ist mit gleichem Zufall reproduzierbar', () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(1))).toEqual(shuffle([1, 2, 3, 4, 5], seeded(1)))
  })
})
