/**
 * Kommentare zur Antwort — der eine trockene Satz unter dem Ergebnis.
 *
 * Reine Funktion, unit-getestet. Der Ton ist knapp und freundlich-spöttisch,
 * nie belehrend: Fehler sind der Normalfall beim Lernen, und die App soll das
 * genauso sehen. Ein Satz je Antwort, nie derselbe zweimal hintereinander,
 * und bei richtigen Antworten nur, wenn es etwas zu sagen gibt (Serie, Karte
 * doch noch gesessen). Sonst bleibt es ruhig.
 */
import { normalize } from './answer'
import type { Verdict } from './answer'

/** Was passiert ist — genauer als das reine Urteil. */
export type QuipOutcome =
  | 'wrong'
  | 'near'
  /** „Weiß ich nicht“ gedrückt. */
  | 'gaveUp'
  /** Selbstbewertung: „Nicht gewusst“. */
  | 'selfAgain'
  /** Beim Abtippen der Lösung danebengetippt. */
  | 'retype'
  | 'correct'

export interface QuipContext {
  outcome: QuipOutcome
  /** Aufeinanderfolgende Fehlversuche bzw. Treffer in der Session, diesen eingeschlossen. */
  streak: number
  /** Die Karte war in dieser Session schon einmal daneben. */
  repeat: boolean
  hintUsed: boolean
  durationMs: number
  typed: string
  answer: string
  prompt: string
  /** Bei `near`: Levenshtein-Abstand zur besten Form. */
  distance?: number
  /** Bei `retype`: der wievielte Fehlversuch beim Abtippen. */
  attempt?: number
  /** Bei `correct`: unmittelbar davor eine Fehlerserie. */
  comeback?: boolean
}

export interface QuipOptions {
  rng?: () => number
  /** Zuletzt gezeigte Sätze — werden gemieden, solange andere übrig sind. */
  recent?: readonly string[]
}

/* ------------------------------------------------------------------ *
 * Die Sätze
 * ------------------------------------------------------------------ */

const ECHOED_PROMPT = ['Das war die Frage.', 'Die Frage zurückgeben zählt nicht.']

const WRONG_SCRIPT = ['Richtige Idee, falsches Alphabet.', 'Das Alphabet stimmt schon mal nicht.']

const BARELY_TYPED = ['Das war eher ein Anfang.', 'Mutig kurz.', 'Ein Buchstabe ist kein Wort.']

const FAST_WRONG = ['Schnell. Aber nein.', 'Tempo stimmt, Rest nicht.', 'Erst denken, dann Enter.']

const SLOW_WRONG = [
  'Lange gegrübelt, trotzdem daneben. Passiert.',
  'Nachdenken war richtig. Das Ergebnis nicht.',
]

const HINT_WRONG = ['Selbst mit Hinweis. Die kommt wieder.', 'Der Hinweis hat nicht gereicht. Nächstes Mal ohne.']

const REPEAT_WRONG = [
  'Die schon wieder. Sie mag dich auch.',
  'Dieselbe Karte, dasselbe Loch.',
  'Alte Bekannte.',
  'Zweiter Anlauf, gleiches Ergebnis. Dritter kommt.',
]

const STREAK_WRONG_5 = [
  'Fünf daneben. Kurz durchatmen — das ist Lernen, nicht Scheitern.',
  'Fünf in Folge. Die Kurve geht ab hier nur nach oben.',
]

const STREAK_WRONG_3 = [
  'Drei in Folge. Kein Drama, nur Statistik.',
  'Kleine Serie. Die endet gleich.',
  'Dritte daneben. Das Deck hat heute Zähne.',
]

const WRONG = [
  'Нет.',
  'Nein. Aber mit Haltung.',
  'Merken. Kommt wieder.',
  'Das Gehirn hat kurz etwas anderes vorgeschlagen.',
  'Nicht ganz. Nicht mal fast.',
  'Jetzt weißt du es.',
  'Die Karte kommt gleich noch mal. Sie freut sich schon.',
  'Kreativ. Leider falsch.',
  'Daneben ist auch vorbei.',
  'Das war ein anderes Wort. Vielleicht sogar ein schönes.',
]

const NEAR_ONE = [
  'Ein Buchstabe. Zählt trotzdem als fast.',
  'Ein Zeichen daneben. Die Tastatur war’s.',
  'So nah, dass es wehtut.',
]

const NEAR_REPEAT = ['Wieder fast. Jetzt aber wirklich hinschauen.', 'Schon wieder knapp. Der Teufel steckt im Detail.']

const NEAR = [
  'Fast. Der Rest ist Feinschliff.',
  'Knapp daneben — genau hinschauen.',
  'Im Groben richtig, im Detail nicht.',
  'Das Wort kennst du. Die Schreibung noch nicht.',
  'Beinahe. Beinahe zählt hier halb.',
]

const GAVE_UP = [
  'Ehrlich ist besser als geraten.',
  'Kein Problem, dafür ist die Karte da.',
  'Jetzt gibt es keine Ausrede mehr.',
  'Notiert. Beim nächsten Mal sitzt es.',
  'Auch eine Antwort. Jetzt die richtige.',
]

const GAVE_UP_REPEAT = ['Die schon wieder nicht? Kommt gleich noch mal.', 'Zweites Mal weiß ich nicht. Drittes Mal weißt du es.']

const SELF_AGAIN = [
  'Ehrlich bewertet. Kommt gleich wieder.',
  'Nicht gewusst ist auch eine Antwort.',
  'Notiert — nach ein paar anderen ist sie zurück.',
  'Passiert. Dafür sitzt sie beim nächsten Mal besser.',
]

const RETYPE_1 = ['Fast. Buchstabengenau, bitte.', 'Noch mal, Zeichen für Zeichen.']
const RETYPE_2 = ['Es steht direkt drüber.', 'Abschreiben, nicht raten.', 'Oben steht die Lösung. Wirklich.']
const RETYPE_4 = ['Esc überspringt. Aber du schaffst das.', 'Vierter Versuch. Die Tastatur ist nicht der Gegner.']

const CORRECT_REPEAT = ['Jetzt sitzt es.', 'Da ist sie.', 'Zweiter Anlauf, gesessen.', 'Na also.']
const COMEBACK = ['Und zurück.', 'Serie gebrochen.', 'Da geht’s wieder.']
const STREAK_OK: Record<number, string[]> = {
  5: ['Fünf am Stück.', 'Fünf in Folge. Läuft.'],
  10: ['Zehn. Ohne Fehler.', 'Zehn in Folge. Das Deck hat Respekt.'],
  20: ['Zwanzig in Folge. Wer bist du?', 'Zwanzig. Das ist kein Glück mehr.'],
}

/* ------------------------------------------------------------------ *
 * Auswahl
 * ------------------------------------------------------------------ */

const CYRILLIC = /[Ѐ-ӿ]/
const LATIN = /[a-zäöüß]/i

/** Antwort in kyrillisch, Eingabe nur lateinisch — oder umgekehrt. */
export function scriptMismatch(typed: string, answer: string): boolean {
  const t = typed.trim()
  if (!t) return false
  const answerCyr = CYRILLIC.test(answer)
  const answerLat = !answerCyr && LATIN.test(answer)
  if (answerCyr) return !CYRILLIC.test(t) && LATIN.test(t)
  if (answerLat) return !LATIN.test(t) && CYRILLIC.test(t)
  return false
}

/** Die Frage selbst wurde als Antwort eingegeben. */
export function echoesPrompt(typed: string, prompt: string): boolean {
  const t = normalize(typed)
  return t.length > 0 && t === normalize(prompt)
}

function candidates(ctx: QuipContext): string[] {
  switch (ctx.outcome) {
    case 'wrong': {
      if (echoesPrompt(ctx.typed, ctx.prompt)) return ECHOED_PROMPT
      if (scriptMismatch(ctx.typed, ctx.answer)) return WRONG_SCRIPT
      if (ctx.streak >= 5) return STREAK_WRONG_5
      if (ctx.repeat) return REPEAT_WRONG
      if (ctx.hintUsed) return HINT_WRONG
      if (ctx.streak >= 3) return STREAK_WRONG_3
      const typedLen = Array.from(ctx.typed.trim()).length
      if (typedLen > 0 && typedLen <= 2 && Array.from(ctx.answer).length > 3) return BARELY_TYPED
      if (ctx.durationMs > 0 && ctx.durationMs < 1500) return FAST_WRONG
      if (ctx.durationMs > 25_000) return SLOW_WRONG
      return WRONG
    }
    case 'near':
      if (ctx.repeat) return NEAR_REPEAT
      if (ctx.distance === 1) return NEAR_ONE
      return NEAR
    case 'gaveUp':
      return ctx.repeat ? GAVE_UP_REPEAT : GAVE_UP
    case 'selfAgain':
      return SELF_AGAIN
    case 'retype': {
      const n = ctx.attempt ?? 1
      if (n >= 4) return RETYPE_4
      if (n >= 2) return RETYPE_2
      return RETYPE_1
    }
    case 'correct': {
      if (ctx.repeat) return CORRECT_REPEAT
      if (ctx.comeback) return COMEBACK
      return STREAK_OK[ctx.streak] ?? []
    }
  }
}

/**
 * Einen Satz wählen — oder `null`, wenn es nichts zu sagen gibt.
 * Deterministisch bei gegebenem `rng`; `recent` wird gemieden, solange
 * mindestens ein anderer Satz übrig ist.
 */
export function pickQuip(ctx: QuipContext, opts: QuipOptions = {}): string | null {
  const all = candidates(ctx)
  if (all.length === 0) return null
  const recent = new Set(opts.recent ?? [])
  const fresh = all.filter((s) => !recent.has(s))
  const pool = fresh.length > 0 ? fresh : all
  const rng = opts.rng ?? Math.random
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)))
  return pool[i] ?? null
}

/* ------------------------------------------------------------------ *
 * Serien innerhalb der Session
 * ------------------------------------------------------------------ */

export interface Streaks {
  /** Treffer in Folge. */
  ok: number
  /** Fehlversuche in Folge — „knapp“ zählt dazu. */
  miss: number
  /** Länge der Fehlerserie, die der letzte Treffer beendet hat. */
  brokenMiss: number
}

export const NO_STREAKS: Streaks = { ok: 0, miss: 0, brokenMiss: 0 }

export function advanceStreaks(s: Streaks, outcome: Verdict): Streaks {
  if (outcome === 'correct') return { ok: s.ok + 1, miss: 0, brokenMiss: s.miss }
  return { ok: 0, miss: s.miss + 1, brokenMiss: 0 }
}

/** Wie viele Sätze gemerkt werden, um Wiederholungen zu vermeiden. */
export const RECENT_QUIPS = 6

export function rememberQuip(recent: readonly string[], quip: string | null): string[] {
  if (!quip) return [...recent]
  return [...recent.filter((q) => q !== quip), quip].slice(-RECENT_QUIPS)
}
