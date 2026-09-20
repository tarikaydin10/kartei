/**
 * Streak-Logik. Bewusst ohne eigenen gespeicherten Zustand: alles wird aus dem
 * Review-Log abgeleitet. Nichts, was kaputtgehen oder beim Sync driften kann.
 *
 * Und bewusst nachsichtig — ein gerissener Streak ist der Moment, an dem Leute
 * eine Lern-App für immer schließen. Eine Lücke im Lauf wird verziehen.
 */
import { dayKey } from '@/lib/date'
import type { Review } from '@/data/types'

export const FORGIVEN_GAPS = 1

export interface DayStat {
  key: string
  reviews: number
  correct: number
}

export function dayStats(reviews: Review[]): Map<string, DayStat> {
  const map = new Map<string, DayStat>()
  for (const r of reviews) {
    const key = dayKey(r.ts)
    let d = map.get(key)
    if (!d) {
      d = { key, reviews: 0, correct: 0 }
      map.set(key, d)
    }
    d.reviews++
    if (r.rating >= 3) d.correct++
  }
  return map
}

export function goalDays(stats: Map<string, DayStat>, dailyGoal: number): Set<string> {
  const out = new Set<string>()
  for (const d of stats.values()) if (d.reviews >= Math.max(1, dailyGoal)) out.add(d.key)
  return out
}

function prevKey(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return dayKey(d)
}

export interface StreakInfo {
  current: number
  best: number
  /** Ziel heute schon erreicht? */
  todayDone: boolean
  /** Eine Lücke wurde überbrückt — der Streak hängt am seidenen Faden. */
  forgivenUsed: number
}

export function computeStreak(
  met: Set<string>,
  todayKey = dayKey(),
  forgiveness = FORGIVEN_GAPS,
): StreakInfo {
  const todayDone = met.has(todayKey)
  // Heute läuft noch — ein noch nicht erreichtes Tagesziel bricht nichts.
  let cursor = todayDone ? todayKey : prevKey(todayKey)
  let current = 0
  let forgivenUsed = 0

  for (;;) {
    if (met.has(cursor)) {
      current++
      cursor = prevKey(cursor)
    } else if (current > 0 && forgivenUsed < forgiveness) {
      forgivenUsed++
      cursor = prevKey(cursor)
    } else {
      break
    }
  }

  return { current, best: longestRun(met), todayDone, forgivenUsed }
}

/** Längster Lauf lückenlos aufeinanderfolgender Zieltage. */
export function longestRun(met: Set<string>): number {
  const keys = [...met].sort()
  let best = 0
  let run = 0
  let prev = ''
  for (const k of keys) {
    run = prev && prevKey(k) === prev ? run + 1 : 1
    if (run > best) best = run
    prev = k
  }
  return best
}

/** Tagesreihe für die Heatmap — lückenlos, auch für Tage ohne Reviews. */
export function lastDays(stats: Map<string, DayStat>, days: number, todayKey = dayKey()): DayStat[] {
  const out: DayStat[] = []
  let cursor = todayKey
  for (let i = 0; i < days; i++) {
    out.push(stats.get(cursor) ?? { key: cursor, reviews: 0, correct: 0 })
    cursor = prevKey(cursor)
  }
  return out.reverse()
}
