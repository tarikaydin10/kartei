/**
 * Dünne Schicht über ts-fsrs (FSRS-6). Der Algorithmus wird nicht selbst
 * gebaut — FSRS ist der Stand der Technik und steckt auch in Anki.
 *
 * Alles hier ist rein: `SrsState` rein, `SrsState` raus. Damit lässt sich der
 * Zustand jederzeit aus dem Review-Log neu berechnen (`replay`), was den
 * späteren Sync konfliktfrei macht.
 */
import { createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs'
import type { Card as FsrsCard, Grade } from 'ts-fsrs'
import type { Rating, Review } from '@/data/types'

export interface SrsState {
  due: number
  stability: number
  difficulty: number
  state: 0 | 1 | 2 | 3
  learningSteps: number
  scheduledDays: number
  reps: number
  lapses: number
  lastReview: number | null
}

export const RATINGS: Rating[] = [1, 2, 3, 4]

export const RATING_LABEL: Record<Rating, string> = {
  1: 'Nochmal',
  2: 'Schwer',
  3: 'Gut',
  4: 'Leicht',
}

const params = generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  maximum_interval: 365 * 5,
  request_retention: 0.9,
})

const engine = fsrs(params)

function fromFsrs(c: FsrsCard): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    state: c.state as 0 | 1 | 2 | 3,
    learningSteps: c.learning_steps ?? 0,
    scheduledDays: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  }
}

function toFsrs(s: SrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReview ? new Date(s.lastReview) : undefined,
  }
}

export function initialState(now = Date.now()): SrsState {
  return fromFsrs(createEmptyCard(new Date(now)))
}

export function applyRating(state: SrsState, rating: Rating, now = Date.now()): SrsState {
  const item = engine.next(toFsrs(state), new Date(now), rating as Grade)
  return fromFsrs(item.card)
}

/** Nächste Fälligkeit je Bewertung — für die Vorschau auf den Buttons. */
export function previewDue(state: SrsState, now = Date.now()): Record<Rating, number> {
  const preview = engine.repeat(toFsrs(state), new Date(now))
  return {
    1: preview[1].card.due.getTime(),
    2: preview[2].card.due.getTime(),
    3: preview[3].card.due.getTime(),
    4: preview[4].card.due.getTime(),
  }
}

/**
 * Zustand aus dem unveränderlichen Review-Log neu berechnen.
 * Wird nach einem Sync-Merge gebraucht und ist die Absicherung dagegen, dass
 * der denormalisierte Zustand auf der Karte je „die Wahrheit“ wird.
 *
 * Übungsantworten (`practice`) stehen im Log, zählen hier aber nicht — sie
 * haben die Karte nie verändert, also darf der Replay es auch nicht.
 */
export function replay(createdAt: number, reviews: Review[]): SrsState {
  let state = initialState(createdAt)
  for (const r of reviews.filter((x) => !x.practice).sort((a, b) => a.ts - b.ts)) {
    state = applyRating(state, r.rating, r.ts)
  }
  return state
}

/**
 * Bewertung aus der getippten Antwort ableiten — eine Eingabe pro Karte statt
 * Tippen *und* Selbsteinschätzung. Das halbiert die Entscheidungen pro Karte.
 */
export function deriveRating(
  verdict: 'correct' | 'near' | 'wrong',
  durationMs: number,
  answerLength: number,
  state: SrsState['state'],
): Rating {
  if (verdict === 'wrong') return 1
  if (verdict === 'near') return 2
  // Souverän und schnell abgerufen -> längeres Intervall verdient.
  if (state === 2 && durationMs > 0 && durationMs <= fastThreshold(answerLength)) return 4
  return 3
}

/**
 * Selbstbewertung nach dem Aufdecken — für Karten, deren Antwort sich nicht
 * zeichenweise prüfen lässt (`grading: 'self'`). Drei Stufen statt vier:
 * „Leicht“ ist beim Selbsteinschätzen kaum von „Gut“ zu trennen und verleitet
 * dazu, sich zu überschätzen.
 */
export type SelfGrade = 'again' | 'hard' | 'good'

export const SELF_GRADES: SelfGrade[] = ['again', 'hard', 'good']

export const SELF_GRADE_LABEL: Record<SelfGrade, string> = {
  again: 'Nicht gewusst',
  hard: 'Mühsam',
  good: 'Gewusst',
}

export function selfRating(grade: SelfGrade): Rating {
  if (grade === 'again') return 1
  if (grade === 'hard') return 2
  return 3
}

/**
 * Wie die Selbstbewertung in der Session zählt — dieselben drei Ausgänge wie
 * bei getippten Antworten, damit Trefferquote und „Fehler üben“ gleich bleiben.
 */
export function selfOutcome(grade: SelfGrade): 'correct' | 'near' | 'wrong' {
  if (grade === 'again') return 'wrong'
  if (grade === 'hard') return 'near'
  return 'correct'
}

/**
 * „Ich hatte recht“: die Prüfung hat eine richtige Antwort verworfen, etwa ein
 * Synonym, das nicht in der Liste steht. Zählt als „Gut“, nie als „Leicht“ —
 * und mit Hinweis wie sonst auch höchstens als „Schwer“.
 */
export function overruleRating(hintUsed: boolean): Rating {
  return hintUsed ? 2 : 3
}

export function fastThreshold(answerLength: number): number {
  return Math.min(8000, 1200 + 200 * Math.max(1, answerLength))
}
