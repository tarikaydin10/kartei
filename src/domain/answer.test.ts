import { describe, expect, it } from 'vitest'
import {
  acceptedForms,
  checkAnswer,
  diffChars,
  foldGerman,
  levenshtein,
  normalize,
  withoutStress,
} from './answer'

describe('normalize', () => {
  it('entfernt Betonungszeichen', () => {
    expect(normalize('сто́л')).toBe('стол')
    expect(normalize('приве́т')).toBe('привет')
    expect(normalize('хорошо̀')).toBe('хорошо')
  })

  it('erhält й — das ist и + Breve, kein Betonungszeichen', () => {
    expect(normalize('чай')).toBe('чай')
    expect(normalize('чай')).not.toBe('чаи')
    expect(normalize('мой')).not.toBe(normalize('мои'))
  })

  it('erhält deutsche Umlaute', () => {
    expect(normalize('Tür')).toBe('tür')
    expect(normalize('Tür')).not.toBe('tur')
  })

  it('behandelt ё und е als gleich, wenn gewünscht', () => {
    expect(normalize('ёлка')).toBe('елка')
    expect(normalize('ёлка', { ignoreYo: false, ignoreCase: true })).toBe('ёлка')
  })

  it('räumt Leerzeichen und Randzeichen auf', () => {
    expect(normalize('  der   Tisch. ')).toBe('der tisch')
    expect(normalize('«привет»')).toBe('привет')
  })

  it('unterscheidet ь und ъ weiterhin', () => {
    expect(normalize('мать')).not.toBe(normalize('мат'))
    expect(normalize('объект')).not.toBe(normalize('обект'))
  })
})

describe('acceptedForms', () => {
  it('trennt Alternativen an |', () => {
    expect(acceptedForms('Tisch|Tafel')).toContain('Tisch')
    expect(acceptedForms('Tisch|Tafel')).toContain('Tafel')
  })

  it('macht Klammerzusätze optional', () => {
    const forms = acceptedForms('Schule (Gebäude)')
    expect(forms).toContain('Schule (Gebäude)')
    expect(forms).toContain('Schule')
  })

  it('macht einen führenden Artikel optional', () => {
    expect(acceptedForms('der Tisch')).toContain('Tisch')
  })

  it('lässt kurze Wörter nach Artikelentfernung in Ruhe', () => {
    expect(acceptedForms('die Uhr')).toContain('Uhr')
    expect(acceptedForms('das A')).toEqual(['das A'])
  })
})

describe('checkAnswer', () => {
  it('akzeptiert die richtige Antwort', () => {
    expect(checkAnswer('Tisch', 'Tisch').verdict).toBe('correct')
  })

  it('ist bei Groß-/Kleinschreibung und Betonung nachsichtig', () => {
    expect(checkAnswer('стол', 'сто́л').verdict).toBe('correct')
    expect(checkAnswer('TISCH', 'Tisch').verdict).toBe('correct')
  })

  it('akzeptiert jede Alternative', () => {
    expect(checkAnswer('Tafel', 'Tisch|Tafel').verdict).toBe('correct')
    expect(checkAnswer('Tisch', 'Tisch|Tafel').best).toBe('Tisch')
  })

  it('akzeptiert ae für ä', () => {
    const r = checkAnswer('Tuer', 'Tür')
    expect(r.verdict).toBe('correct')
    expect(r.lenient).toBe(true)
  })

  it('wertet einen Tippfehler als knapp daneben', () => {
    const r = checkAnswer('привит', 'приве́т')
    expect(r.verdict).toBe('near')
    expect(r.distance).toBe(1)
  })

  it('wertet ein anderes Wort als falsch', () => {
    expect(checkAnswer('Stuhl', 'Tisch').verdict).toBe('wrong')
  })

  it('ist bei kurzen Wörtern streng — ein Buchstabe ist dort das Wort', () => {
    expect(checkAnswer('дом', 'дым').verdict).toBe('wrong')
  })

  it('behandelt leere Eingabe als falsch', () => {
    const r = checkAnswer('   ', 'Tisch')
    expect(r.verdict).toBe('wrong')
    expect(r.best).toBe('Tisch')
  })

  it('akzeptiert die Antwort mit und ohne Artikel', () => {
    expect(checkAnswer('Tisch', 'der Tisch').verdict).toBe('correct')
    expect(checkAnswer('der Tisch', 'der Tisch').verdict).toBe('correct')
  })
})

describe('levenshtein', () => {
  it('rechnet korrekt', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
  })

  it('bricht oberhalb von max ab', () => {
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBeGreaterThan(2)
  })
})

describe('diffChars', () => {
  it('markiert überflüssige und fehlende Zeichen', () => {
    const segs = diffChars('привит', 'привет')
    expect(segs.filter((s) => s.type === 'extra').map((s) => s.text)).toEqual(['и'])
    expect(segs.filter((s) => s.type === 'missing').map((s) => s.text)).toEqual(['е'])
  })

  it('gibt bei Gleichheit ein Segment zurück', () => {
    expect(diffChars('Tisch', 'Tisch')).toEqual([{ type: 'same', text: 'Tisch' }])
  })
})

describe('Hilfsfunktionen', () => {
  it('foldGerman ersetzt Umlaute', () => {
    expect(foldGerman('Größe')).toBe('Groesse')
  })

  it('withoutStress lässt й intakt', () => {
    expect(withoutStress('ча́й')).toBe('чай')
  })
})
