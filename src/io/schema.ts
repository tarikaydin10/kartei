/**
 * Austauschformat. Ein einziges, versioniertes JSON — kein Binärformat.
 *
 * Zwei Regeln machen Import „ohne Probleme“:
 *   1. Stabile UUIDs in der Datei  -> erneuter Import ist ein Upsert, kein Duplikat.
 *   2. Inhalt und Fortschritt getrennt -> ein aktualisiertes Deck überschreibt
 *      Notizen, ohne den Lernfortschritt anzufassen.
 */
import type { Card, Deck, Note, Review } from '@/data/types'
import { inferNoteType, isNoteTypeId } from '@/domain/notetypes'

export const FORMAT = 'kartei'
export const SCHEMA_VERSION = 1

export interface ExportFile {
  format: typeof FORMAT
  schemaVersion: number
  exportedAt: number
  app: string
  /** Enthält die Datei Karten und Reviews (Backup) oder nur Inhalt (Teilen)? */
  includesProgress: boolean
  decks: Deck[]
  notes: Note[]
  cards?: Card[]
  reviews?: Review[]
}

export type Parsed =
  | { ok: true; file: ExportFile; lenient: boolean }
  | { ok: false; error: string }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Absichtlich nachsichtig: eine handgeschriebene Liste von Notizen oder ein
 * `{ notes: [...] }` ohne Format-Marker wird akzeptiert. Was fehlt, wird
 * ergänzt; was unbrauchbar ist, wird beim Import gezählt und gemeldet.
 */
export function parseExportFile(raw: unknown): Parsed {
  let data = raw
  let lenient = false

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      return { ok: false, error: `Kein gültiges JSON: ${(e as Error).message}` }
    }
  }

  if (Array.isArray(data)) {
    data = { notes: data }
    lenient = true
  }
  if (!isObj(data)) return { ok: false, error: 'Die Datei enthält kein Objekt.' }

  if (data.format !== FORMAT) lenient = true
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Die Datei kommt aus einer neueren Version (Schema ${version}). Bitte die App aktualisieren.`,
    }
  }

  const notesRaw = Array.isArray(data.notes) ? data.notes : null
  if (!notesRaw) return { ok: false, error: 'Es fehlt die Liste `notes`.' }

  const notes: Note[] = []
  for (const n of notesRaw) {
    if (!isObj(n)) continue
    const fields = isObj(n.fields) ? (n.fields as Record<string, string>) : null
    if (!fields) continue
    const noteTypeId = isNoteTypeId(n.noteTypeId) ? n.noteTypeId : inferNoteType(fields)
    notes.push({
      id: typeof n.id === 'string' ? n.id : '',
      createdAt: num(n.createdAt, Date.now()),
      updatedAt: num(n.updatedAt, Date.now()),
      deletedAt: typeof n.deletedAt === 'number' ? n.deletedAt : null,
      deckId: typeof n.deckId === 'string' ? n.deckId : '',
      noteTypeId,
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]),
      ),
      tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : [],
    })
  }
  if (notes.length === 0) return { ok: false, error: 'Keine verwertbaren Notizen in der Datei.' }

  const decks: Deck[] = (Array.isArray(data.decks) ? data.decks : [])
    .filter(isObj)
    .map((d, i) => {
      const id = typeof d.id === 'string' ? d.id : ''
      return {
        id,
        createdAt: num(d.createdAt, Date.now()),
        updatedAt: num(d.updatedAt, Date.now()),
        deletedAt: typeof d.deletedAt === 'number' ? d.deletedAt : null,
        name: typeof d.name === 'string' && d.name.trim() ? d.name : `Import ${i + 1}`,
        emoji: typeof d.emoji === 'string' ? d.emoji : '🗂️',
        // Ohne Angabe bestimmen die eigenen Notizen den Typ des Decks.
        noteTypeId: isNoteTypeId(d.noteTypeId)
          ? d.noteTypeId
          : (notes.find((n) => n.deckId === id) ?? notes[0]!).noteTypeId,
        newPerDay: num(d.newPerDay, 0),
        sortOrder: num(d.sortOrder, i),
      }
    })

  const cards = Array.isArray(data.cards) ? (data.cards.filter(isObj) as unknown as Card[]) : undefined
  const reviews = Array.isArray(data.reviews)
    ? (data.reviews.filter(isObj) as unknown as Review[])
    : undefined

  return {
    ok: true,
    lenient,
    file: {
      format: FORMAT,
      schemaVersion: version || SCHEMA_VERSION,
      exportedAt: num(data.exportedAt, Date.now()),
      app: typeof data.app === 'string' ? data.app : 'unbekannt',
      includesProgress: Boolean(cards?.length || reviews?.length),
      decks,
      notes,
      cards,
      reviews,
    },
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
