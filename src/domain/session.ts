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
import type { Card, ID } from '@/data/types'

/* ------------------------------------------------------------------ *
 * Lernmodi — mehr als der Tagesplan
 * ------------------------------------------------------------------ */

/**
 * `due` ist der Tagesplan. `ahead` und `new` zählen ebenfalls für FSRS —
 * sie holen nur Arbeit nach vorn. Die übrigen Modi sind *Übung*: ihre
 * Antworten landen im Log (Tagesziel, Heatmap), ändern aber die Planung
 * nicht, weil `replay` sie überspringt. Sonst würde Pauken am selben Tag die
 * Intervalle aufblähen.
 */
export type StudyMode = 'due' | 'ahead' | 'new' | 'today' | 'hard' | 'random' | 'repeat'

export interface StudyModeInfo {
  label: string
  short: string
  description: string
  practice: boolean
}

export const STUDY_MODES: Record<StudyMode, StudyModeInfo> = {
  due: {
    label: 'Tagesplan',
    short: 'Plan',
    description: 'Fällige und neue Karten bis zum Tageslimit.',
    practice: false,
  },
  ahead: {
    label: 'Vorarbeiten',
    short: 'Vorarbeiten',
    description: 'Was als Nächstes fällig wird. Zählt normal — früh wiederholt wächst das Intervall etwas weniger.',
    practice: false,
  },
  new: {
    label: 'Zusätzliche neue Karten',
    short: 'Neu',
    description: 'Über das Tageslimit hinaus. Heißt morgen mehr Wiederholungen.',
    practice: false,
  },
  today: {
    label: 'Heute gelernte',
    short: 'Üben',
    description: 'Alles, was heute schon dran war, noch einmal.',
    practice: true,
  },
  hard: {
    label: 'Schwierige Karten',
    short: 'Üben',
    description: 'Oft vergessen oder zuletzt falsch beantwortet.',
    practice: true,
  },
  random: {
    label: 'Zufällig gemischt',
    short: 'Üben',
    description: 'Querbeet aus allem, was du schon kennst.',
    practice: true,
  },
  repeat: {
    label: 'Session wiederholen',
    short: 'Üben',
    description: 'Dieselben Karten noch einmal.',
    practice: true,
  },
}

export function isPractice(mode: StudyMode): boolean {
  return STUDY_MODES[mode].practice
}

/** Ab dieser FSRS-Schwierigkeit (1–10) gilt eine Karte als schwierig. */
export const HARD_DIFFICULTY = 6

/**
 * Wie schwierig eine Karte ist — 0 heißt „nicht schwierig“.
 * `misses` = falsche Antworten in letzter Zeit, auch aus Übungen.
 */
export function hardness(card: Card, misses = 0): number {
  if (card.state === 0) return 0
  let score = card.lapses * 2 + misses * 3
  if (card.state === 3) score += 2
  if (card.difficulty >= HARD_DIFFICULTY) score += 1 + (card.difficulty - HARD_DIFFICULTY)
  return score
}

export interface PickContext {
  now: number
  /** Restkontingent neuer Karten für den Tagesplan. */
  newLimit: number
  /** Karten mit einer Antwort heute. */
  todayIds: Set<ID>
  /** Falsche Antworten je Karte in letzter Zeit. */
  misses: Map<ID, number>
  /** Für `repeat`: genau diese Karten. */
  cardIds?: ID[]
  rng?: () => number
}

export interface PoolCounts {
  ahead: number
  fresh: number
  today: number
  hard: number
  known: number
}

const known = (c: Card) => !c.suspended && c.state !== 0

/** Wie viele Karten jeder Modus hergäbe — für die Auswahl. */
export function poolCounts(cards: Card[], ctx: Pick<PickContext, 'now' | 'todayIds' | 'misses'>): PoolCounts {
  const out: PoolCounts = { ahead: 0, fresh: 0, today: 0, hard: 0, known: 0 }
  for (const c of cards) {
    if (c.suspended) continue
    if (c.state === 0) {
      out.fresh++
      continue
    }
    out.known++
    if (c.due > ctx.now) out.ahead++
    if (ctx.todayIds.has(c.id)) out.today++
    if (hardness(c, ctx.misses.get(c.id) ?? 0) > 0) out.hard++
  }
  return out
}

/**
 * Karten für einen Modus auswählen. `cards` sind die lebenden Karten des
 * Decks (oder aller Decks); gesperrte werden hier aussortiert.
 */
export function pickCards(mode: StudyMode, cards: Card[], size: number, ctx: PickContext): Card[] {
  const n = Math.max(1, size)
  const rng = ctx.rng ?? Math.random
  const active = cards.filter((c) => !c.suspended)

  switch (mode) {
    case 'due': {
      const due = active.filter((c) => c.state !== 0 && c.due <= ctx.now)
      const fresh = active.filter((c) => c.state === 0)
      return buildQueue(due, fresh, { size: n, newLimit: ctx.newLimit, now: ctx.now })
    }
    case 'ahead':
      // Die am frühesten fälligen zuerst — die verlieren am wenigsten durchs Vorziehen.
      return active
        .filter((c) => c.state !== 0 && c.due > ctx.now)
        .sort((a, b) => a.due - b.due)
        .slice(0, n)
    case 'new':
      return active
        .filter((c) => c.state === 0)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .slice(0, n)
    case 'today':
      return shuffle(active.filter((c) => known(c) && ctx.todayIds.has(c.id)), rng).slice(0, n)
    case 'hard': {
      const scored = active
        .map((c) => ({ c, s: hardness(c, ctx.misses.get(c.id) ?? 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.c.due - b.c.due)
        .slice(0, n)
        .map((x) => x.c)
      // Die schwierigsten auswählen, aber gemischt abfragen — sonst lernt man die Reihenfolge.
      return shuffle(scored, rng)
    }
    case 'random':
      return shuffle(active.filter(known), rng).slice(0, n)
    case 'repeat': {
      const wanted = new Set(ctx.cardIds ?? [])
      return shuffle(active.filter((c) => wanted.has(c.id)), rng)
    }
  }
}

/** Fisher-Yates. Rein, solange `rng` es ist. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Tagesplan
 * ------------------------------------------------------------------ */

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
