import { describe, expect, it } from 'vitest'
import {
  SELF_GRADES,
  applyRating,
  deriveRating,
  fastThreshold,
  initialState,
  previewDue,
  replay,
  selfOutcome,
  selfRating,
} from './srs'
import type { Rating, Review } from '@/data/types'

const T0 = Date.parse('2026-09-20T09:00:00Z')

function review(ts: number, rating: Rating): Review {
  return {
    id: `r${ts}`,
    cardId: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ts,
    rating,
    durationMs: 2000,
    typed: '',
    verdict: rating === 1 ? 'wrong' : 'correct',
    wasNew: false,
    deviceId: 'dev',
  }
}

describe('initialState', () => {
  it('startet als neue Karte, sofort fällig', () => {
    const s = initialState(T0)
    expect(s.state).toBe(0)
    expect(s.reps).toBe(0)
    expect(s.due).toBeLessThanOrEqual(T0)
  })
})

describe('applyRating', () => {
  it('erhöht die Wiederholungszahl', () => {
    const s = applyRating(initialState(T0), 3, T0)
    expect(s.reps).toBe(1)
    expect(s.lastReview).toBe(T0)
  })

  it('verlängert das Intervall mit besserer Bewertung', () => {
    const base = applyRating(applyRating(initialState(T0), 3, T0), 3, T0 + 6e5)
    const day = 864e5
    const hard = applyRating(base, 2, T0 + 10 * day)
    const good = applyRating(base, 3, T0 + 10 * day)
    const easy = applyRating(base, 4, T0 + 10 * day)
    expect(hard.due).toBeLessThan(good.due)
    expect(good.due).toBeLessThan(easy.due)
  })

  it('zählt einen Rückfall aus dem Review-Zustand als lapse', () => {
    let s = initialState(T0)
    const day = 864e5
    for (let i = 0; i < 4; i++) s = applyRating(s, 3, T0 + i * day * 3)
    expect(s.state).toBe(2)
    const lapsed = applyRating(s, 1, T0 + 40 * day)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.state).toBe(3)
  })
})

describe('replay', () => {
  it('rekonstruiert denselben Zustand wie die schrittweise Anwendung', () => {
    const day = 864e5
    const ratings: Rating[] = [3, 3, 1, 3, 4, 3]
    let stepwise = initialState(T0)
    const reviews: Review[] = []
    ratings.forEach((rating, i) => {
      const ts = T0 + i * day
      stepwise = applyRating(stepwise, rating, ts)
      reviews.push(review(ts, rating))
    })

    expect(replay(T0, reviews)).toEqual(stepwise)
  })

  it('ist unabhängig von der Reihenfolge der Log-Einträge', () => {
    const day = 864e5
    const reviews = [review(T0, 3), review(T0 + day, 3), review(T0 + 2 * day, 4)]
    const shuffled = [reviews[2]!, reviews[0]!, reviews[1]!]
    expect(replay(T0, shuffled)).toEqual(replay(T0, reviews))
  })

  it('gibt bei leerem Log den Anfangszustand zurück', () => {
    expect(replay(T0, [])).toEqual(initialState(T0))
  })

  it('überspringt Übungsantworten — sie ändern die Planung nicht', () => {
    const day = 864e5
    const real = [review(T0, 3), review(T0 + 3 * day, 3)]
    const practice = [
      { ...review(T0 + day, 1), id: 'p1', practice: true },
      { ...review(T0 + day + 60_000, 4), id: 'p2', practice: true },
    ]
    expect(replay(T0, [...real, ...practice])).toEqual(replay(T0, real))
  })
})

describe('previewDue', () => {
  it('liefert für jede Bewertung eine Fälligkeit in aufsteigender Reihenfolge', () => {
    const s = applyRating(applyRating(initialState(T0), 3, T0), 3, T0 + 6e5)
    const p = previewDue(s, T0 + 864e5 * 5)
    expect(p[1]).toBeLessThanOrEqual(p[2])
    expect(p[2]).toBeLessThanOrEqual(p[3])
    expect(p[3]).toBeLessThanOrEqual(p[4])
  })
})

describe('deriveRating', () => {
  it('bildet falsch auf „Nochmal“ ab', () => {
    expect(deriveRating('wrong', 1000, 5, 2)).toBe(1)
  })

  it('bildet knapp daneben auf „Schwer“ ab', () => {
    expect(deriveRating('near', 1000, 5, 2)).toBe(2)
  })

  it('bildet richtig auf „Gut“ ab', () => {
    expect(deriveRating('correct', 9000, 5, 2)).toBe(3)
  })

  it('belohnt schnelles Abrufen im Review-Zustand mit „Leicht“', () => {
    expect(deriveRating('correct', 800, 5, 2)).toBe(4)
  })

  it('gibt beim Lernen kein „Leicht“ — dafür ist es zu früh', () => {
    expect(deriveRating('correct', 800, 5, 1)).toBe(3)
    expect(deriveRating('correct', 800, 5, 0)).toBe(3)
  })

  it('gibt langen Antworten mehr Zeit', () => {
    expect(fastThreshold(3)).toBeLessThan(fastThreshold(20))
    expect(fastThreshold(100)).toBeLessThanOrEqual(8000)
  })
})

describe('Selbstbewertung', () => {
  it('bildet drei Stufen auf Nochmal, Schwer und Gut ab — nie auf Leicht', () => {
    expect(SELF_GRADES.map(selfRating)).toEqual([1, 2, 3])
  })

  it('zählt in der Session wie eine getippte Antwort', () => {
    expect(selfOutcome('again')).toBe('wrong')
    expect(selfOutcome('hard')).toBe('near')
    expect(selfOutcome('good')).toBe('correct')
  })
})
