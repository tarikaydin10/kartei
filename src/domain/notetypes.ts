import type { NoteTypeId } from '@/data/types'

export type Lang = 'ru' | 'de'

export interface FieldDef {
  key: string
  label: string
  lang: Lang
  /** Mehrere akzeptierte Antworten werden mit `|` getrennt. */
  alternatives?: boolean
  multiline?: boolean
  required?: boolean
  /**
   * Lautschrift anzeigen (domain/pronounce.ts). `true`: das Feld ist russischer
   * Text, die Lautschrift steht darunter. `'inline'`: Mischtext wie
   * „m., Pl. лю́ди“ — nur die russischen Stellen, jeweils direkt dahinter.
   */
  pronounce?: true | 'inline'
  placeholder?: string
  hint?: string
}

export interface TemplateDef {
  id: string
  label: string
  short: string
  promptField: string
  answerField: string
  /** Sprache der erwarteten Eingabe — entscheidet über die Tastatur. */
  inputLang: Lang
  /** Felder, die nach dem Auflösen als Kontext gezeigt werden. */
  revealFields: string[]
  byDefault: boolean
}

export interface NoteTypeDef {
  id: NoteTypeId
  name: string
  description: string
  fields: FieldDef[]
  templates: TemplateDef[]
  /** Feld, über das beim Import ohne bekannte ID dedupliziert wird. */
  identityField: string
  primaryField: string
  secondaryField: string
}

const RU_VOCAB: NoteTypeDef = {
  id: 'ru-vocab',
  name: 'Russische Vokabel',
  description: 'Wort, Übersetzung, Beispielsatz — erzeugt Erkennen und Produzieren.',
  identityField: 'ru',
  primaryField: 'ru',
  secondaryField: 'de',
  fields: [
    {
      key: 'ru',
      label: 'Russisch',
      lang: 'ru',
      required: true,
      pronounce: true,
      placeholder: 'сто́л',
      hint: 'Betonungszeichen dürfen drin stehen — beim Abfragen sind sie egal.',
    },
    {
      key: 'de',
      label: 'Deutsch',
      lang: 'de',
      required: true,
      alternatives: true,
      placeholder: 'Tisch',
      hint: 'Mehrere gültige Antworten mit | trennen.',
    },
    {
      key: 'grammatik',
      label: 'Grammatik',
      lang: 'ru',
      pronounce: 'inline',
      placeholder: 'm., Pl. столы́',
      hint: 'Genus, Plural, Aspektpartner — frei formuliert.',
    },
    {
      key: 'beispielRu',
      label: 'Beispiel (RU)',
      lang: 'ru',
      multiline: true,
      pronounce: true,
      placeholder: 'Кни́га на столе́.',
    },
    {
      key: 'beispielDe',
      label: 'Beispiel (DE)',
      lang: 'de',
      multiline: true,
      placeholder: 'Das Buch liegt auf dem Tisch.',
    },
    { key: 'notiz', label: 'Notiz', lang: 'de', multiline: true },
  ],
  templates: [
    {
      id: 'ru2de',
      label: 'Russisch → Deutsch',
      short: 'RU→DE',
      promptField: 'ru',
      answerField: 'de',
      inputLang: 'de',
      revealFields: ['grammatik', 'beispielRu', 'beispielDe', 'notiz'],
      byDefault: true,
    },
    {
      id: 'de2ru',
      label: 'Deutsch → Russisch',
      short: 'DE→RU',
      promptField: 'de',
      answerField: 'ru',
      inputLang: 'ru',
      revealFields: ['grammatik', 'beispielRu', 'beispielDe', 'notiz'],
      byDefault: true,
    },
  ],
}

const BASIC: NoteTypeDef = {
  id: 'basic',
  name: 'Einfach',
  description: 'Vorderseite und Rückseite. Für alles andere.',
  identityField: 'vorne',
  primaryField: 'vorne',
  secondaryField: 'hinten',
  fields: [
    { key: 'vorne', label: 'Vorderseite', lang: 'de', required: true, multiline: true },
    {
      key: 'hinten',
      label: 'Rückseite',
      lang: 'de',
      required: true,
      alternatives: true,
      multiline: true,
    },
    { key: 'notiz', label: 'Notiz', lang: 'de', multiline: true },
  ],
  templates: [
    {
      id: 'v2h',
      label: 'Vorne → Hinten',
      short: 'V→H',
      promptField: 'vorne',
      answerField: 'hinten',
      inputLang: 'de',
      revealFields: ['notiz'],
      byDefault: true,
    },
    {
      id: 'h2v',
      label: 'Hinten → Vorne',
      short: 'H→V',
      promptField: 'hinten',
      answerField: 'vorne',
      inputLang: 'de',
      revealFields: ['notiz'],
      byDefault: false,
    },
  ],
}

export const NOTE_TYPES: Record<NoteTypeId, NoteTypeDef> = {
  'ru-vocab': RU_VOCAB,
  basic: BASIC,
}

export const NOTE_TYPE_LIST: NoteTypeDef[] = [RU_VOCAB, BASIC]

export function noteType(id: NoteTypeId): NoteTypeDef {
  return NOTE_TYPES[id] ?? BASIC
}

export function templateOf(id: NoteTypeId, templateId: string): TemplateDef | undefined {
  return noteType(id).templates.find((t) => t.id === templateId)
}

export function fieldOf(id: NoteTypeId, key: string): FieldDef | undefined {
  return noteType(id).fields.find((f) => f.key === key)
}

export function emptyFields(id: NoteTypeId): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of noteType(id).fields) out[f.key] = ''
  return out
}

export function defaultTemplateIds(id: NoteTypeId): string[] {
  return noteType(id)
    .templates.filter((t) => t.byDefault)
    .map((t) => t.id)
}

/** Fehlende Pflichtfelder — für Editor-Validierung und Import. */
export function missingRequired(id: NoteTypeId, fields: Record<string, string>): FieldDef[] {
  return noteType(id).fields.filter((f) => f.required && !(fields[f.key] ?? '').trim())
}
