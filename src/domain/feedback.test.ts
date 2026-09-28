import { describe, expect, it } from 'vitest'
import {
  NO_STREAKS,
  advanceStreaks,
  echoesPrompt,
  pickQuip,
  rememberQuip,
  scriptMismatch,
  type QuipContext,
} from './feedback'

const base: QuipContext = {
  outcome: 'wrong',
  streak: 1,
  repeat: false,
  hintUsed: false,
  durationMs: 4000,
  typed: 'собака',
  answer: 'кошка',
  prompt: 'Katze',
}

const first = () => 0

/** Alle Sätze, die ein Kontext hergibt — über die Wiederholungssperre ausgelesen. */
function allFor(ctx: QuipContext): string[] {
  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    const q = pickQuip(ctx, { rng: first, recent: seen })
    if (!q || seen.includes(q)) break
    seen.push(q)
  }
  return seen
}

describe('scriptMismatch', () => {
  it('erkennt lateinische Eingabe bei kyrillischer Antwort', () => {
    expect(scriptMismatch('koshka', 'кошка')).toBe(true)
    expect(scriptMismatch('кошка', 'кошка')).toBe(false)
  })
  it('erkennt kyrillische Eingabe bei deutscher Antwort', () => {
    expect(scriptMismatch('кошка', 'Katze')).toBe(true)
    expect(scriptMismatch('Hund', 'Katze')).toBe(false)
  })
  it('ignoriert leere Eingaben und Ziffern', () => {
    expect(scriptMismatch('', 'кошка')).toBe(false)
    expect(scriptMismatch('42', 'кошка')).toBe(false)
  })
})

describe('echoesPrompt', () => {
  it('erkennt die zurückgegebene Frage, auch mit anderer Schreibung', () => {
    expect(echoesPrompt('katze ', 'Katze')).toBe(true)
    expect(echoesPrompt('кошка', 'Katze')).toBe(false)
    expect(echoesPrompt('', '')).toBe(false)
  })
})

describe('pickQuip — falsch', () => {
  it('liefert immer einen Satz', () => {
    expect(pickQuip(base)).toBeTypeOf('string')
  })

  it('kommentiert die zurückgegebene Frage', () => {
    expect(pickQuip({ ...base, typed: 'Katze' }, { rng: first })).toBe('Das war die Frage.')
  })

  it('kommentiert das falsche Alphabet', () => {
    expect(pickQuip({ ...base, typed: 'koshka' }, { rng: first })).toMatch(/Alphabet/)
  })

  it('bevorzugt die Serie vor allem anderen', () => {
    expect(pickQuip({ ...base, streak: 5, repeat: true, hintUsed: true }, { rng: first })).toMatch(/Fünf/)
    expect(pickQuip({ ...base, streak: 3 }, { rng: first })).toMatch(/Drei|Serie|Dritte/)
  })

  it('erkennt die wiederholt falsche Karte', () => {
    expect(allFor({ ...base, repeat: true })).toContain('Dieselbe Karte, dasselbe Loch.')
  })

  it('erwähnt den Hinweis', () => {
    expect(pickQuip({ ...base, hintUsed: true }, { rng: first })).toMatch(/Hinweis/)
  })

  it('unterscheidet schnell, langsam und kaum getippt', () => {
    expect(pickQuip({ ...base, durationMs: 800 }, { rng: first })).toBe('Schnell. Aber nein.')
    expect(pickQuip({ ...base, durationMs: 40_000 }, { rng: first })).toMatch(/gegrübelt/)
    expect(pickQuip({ ...base, typed: 'к' }, { rng: first })).toBe('Das war eher ein Anfang.')
  })

  it('bleibt bei kurzen Antworten fair', () => {
    // Zweibuchstabige Antwort, ein Buchstabe getippt: kein „Anfang“-Spott.
    expect(pickQuip({ ...base, typed: 'д', answer: 'да' }, { rng: first })).not.toBe('Das war eher ein Anfang.')
  })
})

describe('pickQuip — knapp, aufgegeben, abgetippt, selbst bewertet', () => {
  it('unterscheidet einen Buchstaben von mehreren', () => {
    expect(pickQuip({ ...base, outcome: 'near', distance: 1 }, { rng: first })).toMatch(/Ein Buchstabe/)
    expect(pickQuip({ ...base, outcome: 'near', distance: 2 }, { rng: first })).toBe('Fast. Der Rest ist Feinschliff.')
  })

  it('bleibt bei „Weiß ich nicht“ freundlich', () => {
    expect(pickQuip({ ...base, outcome: 'gaveUp', typed: '' }, { rng: first })).toBe('Ehrlich ist besser als geraten.')
    expect(pickQuip({ ...base, outcome: 'gaveUp', repeat: true }, { rng: first })).toMatch(/schon wieder/)
  })

  it('wird beim Abtippen mit jedem Versuch deutlicher', () => {
    expect(pickQuip({ ...base, outcome: 'retype', attempt: 1 }, { rng: first })).toMatch(/Buchstabengenau/)
    expect(pickQuip({ ...base, outcome: 'retype', attempt: 2 }, { rng: first })).toBe('Es steht direkt drüber.')
    expect(pickQuip({ ...base, outcome: 'retype', attempt: 4 }, { rng: first })).toMatch(/Esc/)
  })

  it('kommentiert die Selbstbewertung „Nicht gewusst“', () => {
    expect(pickQuip({ ...base, outcome: 'selfAgain' }, { rng: first })).toBeTypeOf('string')
  })
})

describe('pickQuip — richtig', () => {
  it('schweigt bei einem gewöhnlichen Treffer', () => {
    expect(pickQuip({ ...base, outcome: 'correct', streak: 1 })).toBeNull()
    expect(pickQuip({ ...base, outcome: 'correct', streak: 7 })).toBeNull()
  })

  it('feiert Serien nur an runden Marken', () => {
    expect(pickQuip({ ...base, outcome: 'correct', streak: 5 }, { rng: first })).toBe('Fünf am Stück.')
    expect(pickQuip({ ...base, outcome: 'correct', streak: 10 }, { rng: first })).toMatch(/Zehn/)
    expect(pickQuip({ ...base, outcome: 'correct', streak: 20 }, { rng: first })).toMatch(/Zwanzig/)
  })

  it('freut sich, wenn eine vorher falsche Karte sitzt', () => {
    expect(pickQuip({ ...base, outcome: 'correct', repeat: true }, { rng: first })).toBe('Jetzt sitzt es.')
  })

  it('markiert das Ende einer Fehlerserie', () => {
    expect(pickQuip({ ...base, outcome: 'correct', comeback: true }, { rng: first })).toBe('Und zurück.')
  })
})

describe('pickQuip — Wiederholung vermeiden', () => {
  it('meidet zuletzt gezeigte Sätze', () => {
    const a = pickQuip(base, { rng: first })!
    const b = pickQuip(base, { rng: first, recent: [a] })!
    expect(b).not.toBe(a)
  })

  it('fällt auf alle zurück, wenn alles schon dran war', () => {
    const all = allFor(base)
    expect(all.length).toBeGreaterThan(3)
    expect(pickQuip(base, { rng: first, recent: all })).toBe(all[0])
  })

  it('lässt sich vom Zufall nicht aus dem Bereich werfen', () => {
    expect(pickQuip(base, { rng: () => 0.999999 })).toBeTypeOf('string')
    expect(pickQuip(base, { rng: () => 1 })).toBeTypeOf('string')
  })
})

describe('Streaks', () => {
  it('zählt Treffer und Fehler getrennt, „knapp“ als Fehler', () => {
    let s = advanceStreaks(NO_STREAKS, 'correct')
    s = advanceStreaks(s, 'correct')
    expect(s).toEqual({ ok: 2, miss: 0, brokenMiss: 0 })
    s = advanceStreaks(s, 'near')
    s = advanceStreaks(s, 'wrong')
    expect(s).toEqual({ ok: 0, miss: 2, brokenMiss: 0 })
    s = advanceStreaks(s, 'correct')
    expect(s).toEqual({ ok: 1, miss: 0, brokenMiss: 2 })
  })

  it('merkt sich nur die letzten Sätze, ohne Dubletten', () => {
    let r = rememberQuip([], 'a')
    r = rememberQuip(r, 'b')
    r = rememberQuip(r, 'a')
    expect(r).toEqual(['b', 'a'])
    expect(rememberQuip(r, null)).toEqual(['b', 'a'])
    for (let i = 0; i < 10; i++) r = rememberQuip(r, `q${i}`)
    expect(r).toHaveLength(6)
    expect(r[0]).toBe('q4')
  })
})
