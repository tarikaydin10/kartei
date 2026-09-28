import { describe, expect, it } from 'vitest'
import { detectDelimiter, guessMapping, looksLikeHeader, parseDelimited, toCsv } from './csv'

describe('detectDelimiter', () => {
  it('erkennt Komma, Semikolon und Tab', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })

  it('ignoriert Trennzeichen innerhalb von Anführungszeichen', () => {
    expect(detectDelimiter('"a;b";c\n"1;2";3')).toBe(';')
  })

  it('fällt bei einer einzigen Spalte auf Komma zurück', () => {
    expect(detectDelimiter('stol\nchai')).toBe(',')
  })
})

describe('parseDelimited', () => {
  it('parst einfache Zeilen', () => {
    expect(parseDelimited('стол,Tisch\nчай,Tee')).toEqual([
      ['стол', 'Tisch'],
      ['чай', 'Tee'],
    ])
  })

  it('versteht Anführungszeichen und doppelte Anführungszeichen', () => {
    expect(parseDelimited('"Tisch, Tafel","sagt ""hallo"""')).toEqual([
      ['Tisch, Tafel', 'sagt "hallo"'],
    ])
  })

  it('versteht Zeilenumbrüche im Feld', () => {
    expect(parseDelimited('a,"erste\nzweite"\nb,c')).toEqual([
      ['a', 'erste\nzweite'],
      ['b', 'c'],
    ])
  })

  it('verträgt CRLF und eine BOM', () => {
    expect(parseDelimited('﻿a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('überspringt leere Zeilen', () => {
    expect(parseDelimited('a,b\n\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('ist das Gegenstück zu toCsv', () => {
    const rows = [
      ['стол', 'Tisch|Tafel'],
      ['чай', 'Tee, schwarz'],
      ['да', 'ja "sicher"'],
    ]
    expect(parseDelimited(toCsv(rows), ',')).toEqual(rows)
  })
})

describe('looksLikeHeader', () => {
  it('erkennt bekannte Spaltennamen', () => {
    expect(looksLikeHeader(['Russisch', 'Deutsch'])).toBe(true)
    expect(looksLikeHeader(['стол', 'Tisch'])).toBe(false)
    expect(looksLikeHeader(undefined)).toBe(false)
  })
})

describe('guessMapping', () => {
  it('ordnet über die Kopfzeile zu', () => {
    const m = guessMapping(['Deutsch', 'Russisch'], ['ru', 'de', 'notiz'], 2)
    expect(m.ru).toBe(1)
    expect(m.de).toBe(0)
    expect(m.notiz).toBe(-1)
  })

  it('ordnet Konzept-Spalten über die Kopfzeile zu', () => {
    const m = guessMapping(
      ['Frage', 'Antwort', 'Erklärung', 'Quelle'],
      ['frage', 'antwort', 'erklaerung', 'quelle'],
      4,
    )
    expect(m).toEqual({ frage: 0, antwort: 1, erklaerung: 2, quelle: 3 })
  })

  it('ordnet ohne Kopfzeile die ersten zwei Spalten zu', () => {
    const m = guessMapping(['стол', 'Tisch'], ['ru', 'de', 'notiz'], 2)
    expect(m.ru).toBe(0)
    expect(m.de).toBe(1)
    expect(m.notiz).toBe(-1)
  })
})
