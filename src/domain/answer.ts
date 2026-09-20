/**
 * Antwortprüfung. Reine Funktionen, unit-getestet — hier entscheidet sich, ob
 * die App sich fair anfühlt oder nervt.
 *
 * Wichtig für Russisch: NFD-Zerlegung und pauschales Entfernen aller
 * Combining Marks wäre falsch. `й` ist `и` + U+0306 (Breve) und `ё` ist
 * `е` + U+0308 (Trema); deutsche Umlaute ebenso. Entfernt wird deshalb
 * ausschließlich U+0300/U+0301 — die Betonungszeichen.
 */

export interface AnswerOptions {
  ignoreYo: boolean
  ignoreCase: boolean
}

export const DEFAULT_ANSWER_OPTIONS: AnswerOptions = { ignoreYo: true, ignoreCase: true }

/** Nur Akut und Gravis: die Betonungszeichen. Nicht Breve, nicht Trema. */
const STRESS_MARKS = /[̀́]/g
const APOSTROPHES = /[‘’ʼ`´]/g
const DASHES = /[–—−]/g
const EDGE_PUNCT = /^[\s"'„“«(]+|[\s"'“”»).,;:!?]+$/g

/** Kanonische Vergleichsform. */
export function normalize(raw: string, opts: AnswerOptions = DEFAULT_ANSWER_OPTIONS): string {
  let s = (raw ?? '').normalize('NFC')
  // Betonung entfernen, Rest der Kombinationszeichen bewusst erhalten.
  s = s.normalize('NFD').replace(STRESS_MARKS, '').normalize('NFC')
  s = s.replace(APOSTROPHES, "'").replace(DASHES, '-')
  s = s.replace(EDGE_PUNCT, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (opts.ignoreCase) s = s.toLocaleLowerCase('ru')
  if (opts.ignoreYo) s = s.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
  return s
}

/** ä→ae … als Nachsicht-Ebene, wenn die strenge Prüfung scheitert. */
export function foldGerman(s: string): string {
  return s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
}

const LEADING_ARTICLE = /^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer)\s+/i
const PARENTHETICAL = /\s*\([^)]*\)\s*/g

/**
 * Alle akzeptierten Schreibweisen einer Antwort.
 * `|` trennt gleichwertige Antworten; zusätzlich werden Klammerzusätze und
 * ein führender Artikel als optional behandelt.
 */
export function acceptedForms(rawAnswer: string): string[] {
  const out: string[] = []
  const push = (v: string) => {
    const t = v.replace(/\s+/g, ' ').trim()
    if (t && !out.includes(t)) out.push(t)
  }

  for (const alt of (rawAnswer ?? '').split('|')) {
    const base = alt.trim()
    if (!base) continue
    push(base)

    const noParens = base.replace(PARENTHETICAL, ' ').trim()
    if (noParens) push(noParens)

    for (const v of [base, noParens]) {
      const noArticle = v.replace(LEADING_ARTICLE, '').trim()
      if (noArticle.length >= 2) push(noArticle)
    }
  }
  return out
}

/** Die Varianten, die dem Nutzer als „auch richtig“ angezeigt werden. */
export function displayForms(rawAnswer: string): string[] {
  return (rawAnswer ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Levenshtein mit Abbruch, sobald `max` überschritten ist. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0
  const s = Array.from(a)
  const t = Array.from(b)
  if (Math.abs(s.length - t.length) > max) return max + 1
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length

  let prev = Array.from<number>({ length: t.length + 1 })
  let curr = Array.from<number>({ length: t.length + 1 })
  for (let j = 0; j <= t.length; j++) prev[j] = j

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    let rowMin = curr[0]!
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      if (curr[j]! < rowMin) rowMin = curr[j]!
    }
    if (rowMin > max) return max + 1
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[t.length]!
}

/** Ab wann „knapp daneben“ statt „falsch“: ein Tippfehler, bei langen Wörtern zwei. */
export function nearThreshold(answer: string): number {
  const n = Array.from(answer).length
  if (n <= 4) return 0
  if (n <= 9) return 1
  return 2
}

export type Verdict = 'correct' | 'near' | 'wrong'

export interface DiffSegment {
  type: 'same' | 'missing' | 'extra'
  text: string
}

export interface AnswerCheck {
  verdict: Verdict
  /** Die akzeptierte Form, die am besten zur Eingabe passt. */
  best: string
  distance: number
  /** Zeichenweiser Vergleich Eingabe → korrekte Antwort, für die Anzeige. */
  diff: DiffSegment[]
  /** Nur Groß/Klein oder Betonung anders — wurde toleriert. */
  lenient: boolean
}

export function checkAnswer(
  typed: string,
  rawAnswer: string,
  opts: AnswerOptions = DEFAULT_ANSWER_OPTIONS,
): AnswerCheck {
  const forms = acceptedForms(rawAnswer)
  const primary = forms[0] ?? ''
  const nTyped = normalize(typed, opts)

  if (!nTyped) {
    return {
      verdict: 'wrong',
      best: primary,
      distance: Array.from(normalize(primary, opts)).length,
      diff: [{ type: 'missing', text: primary }],
      lenient: false,
    }
  }

  let best = primary
  let bestDistance = Number.POSITIVE_INFINITY
  let exact = false
  let lenient = false

  for (const form of forms) {
    const nForm = normalize(form, opts)
    if (nTyped === nForm) {
      best = form
      bestDistance = 0
      exact = true
      lenient = typed.trim() !== form.trim()
      break
    }
    if (foldGerman(nTyped) === foldGerman(nForm)) {
      best = form
      bestDistance = 0
      exact = true
      lenient = true
      break
    }
    const d = levenshtein(nTyped, nForm)
    if (d < bestDistance) {
      bestDistance = d
      best = form
    }
  }

  if (exact) return { verdict: 'correct', best, distance: 0, diff: [{ type: 'same', text: best }], lenient }

  const verdict: Verdict = bestDistance <= nearThreshold(best) ? 'near' : 'wrong'
  return { verdict, best, distance: bestDistance, diff: diffChars(typed.trim(), best), lenient: false }
}

/**
 * Zeichenweiser Diff über die längste gemeinsame Teilfolge.
 * `missing` = steht in der Lösung, fehlte in der Eingabe.
 * `extra`   = wurde getippt, gehört nicht dazu.
 */
export function diffChars(typed: string, answer: string): DiffSegment[] {
  const a = Array.from(typed)
  const b = Array.from(answer)
  const eq = (x: string, y: string) => x.toLocaleLowerCase('ru') === y.toLocaleLowerCase('ru')

  // LCS-Tabelle. Antworten sind kurz, die Kosten sind irrelevant.
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from<number>({ length: n + 1 }).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const segs: DiffSegment[] = []
  const push = (type: DiffSegment['type'], ch: string) => {
    const last = segs[segs.length - 1]
    if (last && last.type === type) last.text += ch
    else segs.push({ type, text: ch })
  }

  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (eq(a[i]!, b[j]!)) {
      push('same', b[j]!)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('extra', a[i]!)
      i++
    } else {
      push('missing', b[j]!)
      j++
    }
  }
  while (i < m) push('extra', a[i++]!)
  while (j < n) push('missing', b[j++]!)
  return segs
}

/** Anzeigeform ohne Betonungszeichen (z. B. für Vergleichsanzeige). */
export function withoutStress(s: string): string {
  return (s ?? '').normalize('NFD').replace(STRESS_MARKS, '').normalize('NFC')
}
