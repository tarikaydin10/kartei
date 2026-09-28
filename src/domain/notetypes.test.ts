import { describe, expect, it } from 'vitest'
import { NOTE_TYPE_LIST, inferNoteType, isNoteTypeId, noteType } from './notetypes'

describe('Notiztypen', () => {
  it('jede Vorlage verweist auf vorhandene Felder', () => {
    for (const t of NOTE_TYPE_LIST) {
      const keys = new Set(t.fields.map((f) => f.key))
      for (const tpl of t.templates) {
        expect(keys.has(tpl.promptField), `${t.id}/${tpl.id} prompt`).toBe(true)
        expect(keys.has(tpl.answerField), `${t.id}/${tpl.id} answer`).toBe(true)
        for (const r of tpl.revealFields) expect(keys.has(r), `${t.id}/${tpl.id} ${r}`).toBe(true)
      }
      expect(keys.has(t.identityField)).toBe(true)
    }
  })

  it('Vokabeln werden getippt, Konzepte selbst bewertet', () => {
    expect(noteType('ru-vocab').templates.every((t) => t.grading === 'typed')).toBe(true)
    expect(noteType('basic').templates.every((t) => t.grading === 'typed')).toBe(true)
    expect(noteType('concept').templates.every((t) => t.grading === 'self')).toBe(true)
  })
})

describe('isNoteTypeId', () => {
  it('kennt genau die definierten Typen', () => {
    expect(isNoteTypeId('ru-vocab')).toBe(true)
    expect(isNoteTypeId('concept')).toBe(true)
    expect(isNoteTypeId('basic')).toBe(true)
    expect(isNoteTypeId('toString')).toBe(false)
    expect(isNoteTypeId(undefined)).toBe(false)
  })
})

describe('inferNoteType', () => {
  it('erkennt den Typ an den Pflichtfeldern', () => {
    expect(inferNoteType({ ru: 'стол', de: 'Tisch' })).toBe('ru-vocab')
    expect(inferNoteType({ frage: 'Warum?', antwort: 'Darum.', erklaerung: '' })).toBe('concept')
    expect(inferNoteType({ vorne: 'A', hinten: 'B' })).toBe('basic')
  })

  it('fällt auf Russisch zurück', () => {
    expect(inferNoteType({ irgendwas: 'x' })).toBe('ru-vocab')
  })
})
