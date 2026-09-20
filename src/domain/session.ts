/**
 * Aufbau der Lern-Warteschlange.
 *
 * Zwei psychologische Entscheidungen stecken hier drin:
 *
 * 1. Eine Session hat eine *feste, sichtbare Länge*. Nie eine offene
 *    Schlange — ein sichtbares Ende zieht durch (Ziel-Gradient), eine
 *    unendliche Liste lähmt.
 * 2. Auch bei Rückstand sind bis zu 30 % der Plätze für neue Karten
 *    reserviert. Ein Backlog, der jedes Lernen blockiert, ist der schnellste
 *    Weg zum Aufgeben.
 */
import type { Card } from '@/data/types'

export interface QueueOptions {
  size: number
  newLimit: number
  now?: number
  /** Anteil der Session, der neuen Karten vorbehalten bleibt. */
  newShare?: number
}

export function isDue(card: Card, now = Date.now()): boolean {
  return !card.suspended && card.state !== 0 && card.due <= now
}

export function isNew(card: Card): boolean {
  return !card.suspended && card.state === 0
}

/**
 * `due` und `fresh` dürfen unsortiert übergeben werden.
 * Ergebnis: höchstens `size` Karten, neue gleichmäßig eingestreut.
 */
export function buildQueue(due: Card[], fresh: Card[], opts: QueueOptions): Card[] {
  const size = Math.max(1, opts.size)
  const newShare = opts.newShare ?? 0.3

  const dueSorted = [...due].sort((a, b) => a.due - b.due)
  const freshSorted = [...fresh].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  const wantNew = Math.min(freshSorted.length, Math.max(0, opts.newLimit))
  const reservedNew = Math.min(wantNew, Math.round(size * newShare))
  const dueCount = Math.min(dueSorted.length, size - reservedNew)
  const newCount = Math.min(wantNew, size - dueCount)

  return interleave(dueSorted.slice(0, dueCount), freshSorted.slice(0, newCount))
}

/**
 * Neue Karten gleichmäßig zwischen die Wiederholungen legen, aber nicht an
 * Position 0: die ersten Karten sollen bekannte sein (Aufwärmen, früher
 * Erfolg), danach mischen (interleaving).
 */
export function interleave(reviews: Card[], news: Card[]): Card[] {
  if (news.length === 0) return reviews
  if (reviews.length === 0) return news

  const out: Card[] = []
  const warmup = Math.min(2, reviews.length)
  out.push(...reviews.slice(0, warmup))

  const rest = reviews.slice(warmup)
  const total = rest.length + news.length
  const step = total / news.length

  let ri = 0
  let ni = 0
  for (let i = 0; i < total; i++) {
    const wantNewHere = ni < news.length && i >= Math.floor(ni * step)
    if (wantNewHere) out.push(news[ni++]!)
    else if (ri < rest.length) out.push(rest[ri++]!)
    else if (ni < news.length) out.push(news[ni++]!)
  }
  return out
}

/**
 * „Nochmal“ bringt die Karte innerhalb derselben Session zurück — nach
 * `gap` anderen Karten, damit es Abruf bleibt und nicht Abschreiben wird.
 */
export function requeue<T>(queue: T[], pos: number, gap = 3): T[] {
  const item = queue[pos]
  if (item === undefined) return queue
  const rest = queue.slice(pos + 1)
  const insertAt = Math.min(gap, rest.length)
  return [...queue.slice(0, pos + 1), ...rest.slice(0, insertAt), item, ...rest.slice(insertAt)]
}

export interface SessionTally {
  /** Eindeutige Karten, die fertig sind (bestimmt den Fortschrittsbalken). */
  done: number
  total: number
  correct: number
  near: number
  wrong: number
  learnedNew: number
  durationMs: number
}

export function accuracy(t: SessionTally): number {
  const answered = t.correct + t.near + t.wrong
  return answered === 0 ? 0 : t.correct / answered
}
