import { describe, expect, it } from 'vitest'
import { parseExportFile } from './schema'

describe('parseExportFile', () => {
  it('leitet Notiz- und Decktyp aus den Feldern ab, wenn die Angabe fehlt', () => {
    const parsed = parseExportFile({
      decks: [{ name: 'Arbeit' }],
      notes: [{ fields: { frage: 'Wo liegt der Datenzugriff?', antwort: 'In repo.ts.' } }],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.notes[0]!.noteTypeId).toBe('concept')
    expect(parsed.file.decks[0]!.noteTypeId).toBe('concept')
  })

  it('eine ausdrückliche Angabe gewinnt', () => {
    const parsed = parseExportFile({
      decks: [{ id: 'd1', name: 'Einfach', noteTypeId: 'basic' }],
      notes: [{ deckId: 'd1', noteTypeId: 'basic', fields: { vorne: 'A', hinten: 'B' } }],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.notes[0]!.noteTypeId).toBe('basic')
    expect(parsed.file.decks[0]!.noteTypeId).toBe('basic')
  })

  it('bleibt für alte Russisch-Listen ohne Typ bei ru-vocab', () => {
    const parsed = parseExportFile([{ fields: { ru: 'стол', de: 'Tisch' } }])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.notes[0]!.noteTypeId).toBe('ru-vocab')
  })
})
