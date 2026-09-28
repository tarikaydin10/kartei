import { describe, expect, it } from 'vitest'
import doc from '../../public/kartei-format.md?raw'
import { NOTE_TYPE_LIST } from '@/domain/notetypes'

/**
 * Die Formatbeschreibung für LLMs ist Handarbeit. Dieser Test hält sie ehrlich:
 * Jeder Kartentyp und jedes Feld muss darin vorkommen, sonst erzeugen
 * Sprachmodelle Dateien, die der Import nicht versteht.
 */
describe('kartei-format.md', () => {
  it('beschreibt jeden Kartentyp und jedes Feld', () => {
    for (const t of NOTE_TYPE_LIST) {
      expect(doc, t.id).toContain(`\`${t.id}\``)
      for (const f of t.fields) expect(doc, `${t.id}.${f.key}`).toContain(`\`${f.key}\``)
    }
  })

  it('nennt die Bewertungsart jedes Typs richtig', () => {
    for (const t of NOTE_TYPE_LIST) {
      const row = doc.split('\n').find((l) => l.startsWith(`| \`${t.id}\``))
      expect(row, t.id).toBeDefined()
      const self = t.templates.every((tpl) => tpl.grading === 'self')
      expect(row!.includes('selbst'), t.id).toBe(self)
    }
  })
})
