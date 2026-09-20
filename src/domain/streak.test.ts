import { describe, expect, it } from 'vitest'
import { computeStreak, dayStats, goalDays, lastDays, longestRun } from './streak'
import type { Review } from '@/data/types'

function review(ts: number, rating: 1 | 2 | 3 | 4 = 3): Review {
  return {
    id: `r${ts}-${Math.random()}`,
    cardId: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ts,
    rating,
    durationMs: 1000,
    typed: '',
    verdict: rating >= 3 ? 'correct' : 'wrong',
    wasNew: false,
    deviceId: 'dev',
  }
}

const day = (key: string, hour = 12) => Date.parse(`${key}T${String(hour).padStart(2, '0')}:00:00`)

describe('dayStats', () => {
  it('zählt Reviews und Treffer pro Tag', () => {
    const stats = dayStats([
      review(day('2026-09-18')),
      review(day('2026-09-18'), 1),
      review(day('2026-09-19')),
    ])
    expect(stats.get('2026-09-18')).toEqual({ key: '2026-09-18', reviews: 2, correct: 1 })
    expect(stats.get('2026-09-19')!.reviews).toBe(1)
  })
})

describe('goalDays', () => {
  it('zählt nur Tage, an denen das Ziel erreicht wurde', () => {
    const stats = dayStats([
      ...Array.from({ length: 20 }, () => review(day('2026-09-18'))),
      ...Array.from({ length: 5 }, () => review(day('2026-09-19'))),
    ])
    const met = goalDays(stats, 20)
    expect(met.has('2026-09-18')).toBe(true)
    expect(met.has('2026-09-19')).toBe(false)
  })
})

describe('computeStreak', () => {
  it('zählt aufeinanderfolgende Tage', () => {
    const met = new Set(['2026-09-18', '2026-09-19', '2026-09-20'])
    expect(computeStreak(met, '2026-09-20').current).toBe(3)
  })

  it('bricht nicht, weil heute noch nichts gelernt wurde', () => {
    const met = new Set(['2026-09-18', '2026-09-19'])
    const s = computeStreak(met, '2026-09-20')
    expect(s.current).toBe(2)
    expect(s.todayDone).toBe(false)
  })

  it('verzeiht eine einzelne Lücke', () => {
    const met = new Set(['2026-09-16', '2026-09-17', '2026-09-19', '2026-09-20'])
    const s = computeStreak(met, '2026-09-20')
    expect(s.current).toBe(4)
    expect(s.forgivenUsed).toBe(1)
  })

  it('verzeiht keine zwei Lücken hintereinander', () => {
    const met = new Set(['2026-09-15', '2026-09-16', '2026-09-19', '2026-09-20'])
    expect(computeStreak(met, '2026-09-20').current).toBe(2)
  })

  it('ist ohne Daten null', () => {
    expect(computeStreak(new Set(), '2026-09-20').current).toBe(0)
  })

  it('läuft über einen Monatswechsel', () => {
    const met = new Set(['2026-08-30', '2026-08-31', '2026-09-01'])
    expect(computeStreak(met, '2026-09-01').current).toBe(3)
  })

  it('meldet den besten Lauf', () => {
    const met = new Set([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-19',
      '2026-09-20',
    ])
    expect(computeStreak(met, '2026-09-20').best).toBe(4)
  })
})

describe('longestRun', () => {
  it('findet den längsten lückenlosen Lauf', () => {
    expect(longestRun(new Set(['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05']))).toBe(3)
  })

  it('ist bei leerer Menge null', () => {
    expect(longestRun(new Set())).toBe(0)
  })
})

describe('lastDays', () => {
  it('liefert eine lückenlose Reihe in aufsteigender Reihenfolge', () => {
    const stats = dayStats([review(day('2026-09-19'))])
    const series = lastDays(stats, 3, '2026-09-20')
    expect(series.map((d) => d.key)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20'])
    expect(series[1]!.reviews).toBe(1)
    expect(series[0]!.reviews).toBe(0)
  })
})
