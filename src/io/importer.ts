/**
 * Import. Es gibt genau einen Importpfad — JSON und CSV laufen beide hier
 * durch, damit Deduplizierung und Berichterstattung identisch sind.
 *
 * Die Eigenschaft, auf die es ankommt: **idempotent**. Dieselbe Datei zweimal
 * importiert ergibt dieselbe Sammlung, keine Dubletten. Erreicht über
 *   1. Upsert per UUID, und
 *   2. Fallback-Deduplizierung über das Identitätsfeld des Notiztyps,
 *      wenn eine Datei keine bekannten IDs mitbringt (z. B. eine CSV).
 */
import { db } from '@/data/db'
import { newId } from '@/lib/id'
import { normalize } from '@/domain/answer'
import { defaultTemplateIds, missingRequired, noteType } from '@/domain/notetypes'
import { initialState, replay } from '@/domain/srs'
import type { Deck, ID, Note, NoteTypeId, Review } from '@/data/types'
import type { ExportFile } from './schema'

export interface ImportOptions {
  /** Alles in dieses Deck, unabhängig von den Decks in der Datei. */
  targetDeckId?: ID | null
  /** Karten und Reviews aus der Datei übernehmen, falls vorhanden. */
  includeProgress?: boolean
  /** Vorlagen für neu angelegte Notizen. */
  templateIds?: string[]
}

export interface ImportReport {
  decksCreated: number
  notesCreated: number
  notesUpdated: number
  notesUnchanged: number
  cardsCreated: number
  cardsRestored: number
  reviewsImported: number
  problems: string[]
}

const emptyReport = (): ImportReport => ({
  decksCreated: 0,
  notesCreated: 0,
  notesUpdated: 0,
  notesUnchanged: 0,
  cardsCreated: 0,
  cardsRestored: 0,
  reviewsImported: 0,
  problems: [],
})

function identityKey(deckId: ID, noteTypeId: NoteTypeId, fields: Record<string, string>): string {
  const key = noteType(noteTypeId).identityField
  return `${deckId}|${noteTypeId}|${normalize(fields[key] ?? '')}`
}

export async function importExportFile(
  file: ExportFile,
  opts: ImportOptions = {},
): Promise<ImportReport> {
  const report = emptyReport()
  const now = Date.now()
  const includeProgress = opts.includeProgress ?? file.includesProgress

  await db.transaction('rw', db.decks, db.notes, db.cards, db.reviews, async () => {
    /* --- 1. Decks zuordnen ------------------------------------------ */
    const existingDecks = await db.decks.toArray()
    const byId = new Map(existingDecks.map((d) => [d.id, d]))
    const byName = new Map(existingDecks.filter((d) => !d.deletedAt).map((d) => [d.name.trim().toLowerCase(), d]))

    const deckMap = new Map<ID, ID>()
    let fallbackDeck: ID | null = opts.targetDeckId ?? null

    if (!opts.targetDeckId) {
      for (const d of file.decks) {
        if (d.id && byId.has(d.id)) {
          const local = byId.get(d.id)!
          // Ein zuvor gelöschtes Deck wird durch den Import wiederbelebt.
          if (local.deletedAt) await db.decks.put({ ...local, deletedAt: null, updatedAt: now })
          deckMap.set(d.id, local.id)
          continue
        }
        const sameName = byName.get(d.name.trim().toLowerCase())
        if (sameName) {
          deckMap.set(d.id, sameName.id)
          continue
        }
        const deck: Deck = {
          ...d,
          id: d.id || newId(),
          deletedAt: null,
          sortOrder: existingDecks.length + report.decksCreated,
        }
        await db.decks.add(deck)
        deckMap.set(d.id, deck.id)
        byName.set(deck.name.trim().toLowerCase(), deck)
        report.decksCreated++
      }
      fallbackDeck = deckMap.values().next().value ?? null
    }

    if (!fallbackDeck) {
      const firstLive = existingDecks.find((d) => !d.deletedAt)
      if (firstLive) fallbackDeck = firstLive.id
      else {
        const deck: Deck = {
          id: newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          name: 'Import',
          emoji: '📥',
          noteTypeId: file.notes[0]?.noteTypeId ?? 'ru-vocab',
          newPerDay: 0,
          sortOrder: existingDecks.length,
        }
        await db.decks.add(deck)
        fallbackDeck = deck.id
        report.decksCreated++
      }
    }

    const resolveDeck = (fileDeckId: ID): ID =>
      opts.targetDeckId ?? deckMap.get(fileDeckId) ?? fallbackDeck!

    /* --- 2. Notizen upserten --------------------------------------- */
    const existingNotes = await db.notes.toArray()
    const identityIndex = new Map<string, Note>()
    for (const n of existingNotes) {
      if (n.deletedAt) continue
      identityIndex.set(identityKey(n.deckId, n.noteTypeId, n.fields), n)
    }

    /** Datei-Notiz-ID -> lokale Notiz-ID. */
    const noteIdMap = new Map<ID, ID>()
    /** Notizen, die auf eine *andere* lokale Notiz zusammengeführt wurden. */
    const merged = new Set<ID>()
    const needCards: Array<{ note: Note; templateIds: string[] }> = []

    for (const incoming of file.notes) {
      if (incoming.deletedAt) continue
      const missing = missingRequired(incoming.noteTypeId, incoming.fields)
      if (missing.length > 0) {
        report.problems.push(
          `Übersprungen — ${missing.map((f) => f.label).join(', ')} fehlt: „${
            incoming.fields[noteType(incoming.noteTypeId).identityField] || '(leer)'
          }“`,
        )
        continue
      }

      const local = incoming.id ? await db.notes.get(incoming.id) : undefined

      if (local) {
        noteIdMap.set(incoming.id, local.id)
        if (incoming.updatedAt > local.updatedAt || local.deletedAt) {
          await db.notes.put({
            ...local,
            fields: incoming.fields,
            tags: incoming.tags,
            // Die Einordnung des Nutzers gewinnt — außer er importiert
            // ausdrücklich in ein bestimmtes Deck.
            deckId: opts.targetDeckId ?? local.deckId,
            deletedAt: null,
            updatedAt: Math.max(incoming.updatedAt, now),
          })
          report.notesUpdated++
        } else {
          report.notesUnchanged++
        }
        continue
      }

      const deckId = resolveDeck(incoming.deckId)
      const dupe = identityIndex.get(identityKey(deckId, incoming.noteTypeId, incoming.fields))
      if (dupe) {
        noteIdMap.set(incoming.id, dupe.id)
        merged.add(incoming.id)
        if (incoming.updatedAt > dupe.updatedAt) {
          await db.notes.put({
            ...dupe,
            fields: { ...dupe.fields, ...incoming.fields },
            tags: [...new Set([...dupe.tags, ...incoming.tags])],
            updatedAt: now,
          })
          report.notesUpdated++
        } else {
          report.notesUnchanged++
        }
        continue
      }

      const note: Note = {
        ...incoming,
        id: incoming.id || newId(),
        deckId,
        deletedAt: null,
        createdAt: incoming.createdAt || now,
        updatedAt: incoming.updatedAt || now,
      }
      await db.notes.add(note)
      identityIndex.set(identityKey(deckId, note.noteTypeId, note.fields), note)
      noteIdMap.set(incoming.id, note.id)
      needCards.push({
        note,
        templateIds: opts.templateIds ?? defaultTemplateIds(note.noteTypeId),
      })
      report.notesCreated++
    }

    /* --- 3. Fortschritt (Karten) ----------------------------------- */
    const touchedCards = new Set<ID>()

    if (includeProgress && file.cards?.length) {
      for (const incoming of file.cards) {
        const localNoteId = noteIdMap.get(incoming.noteId)
        // Auf eine andere Notiz zusammengeführt: dort gilt der lokale
        // Fortschritt, der aus der Datei wird verworfen.
        if (!localNoteId || merged.has(incoming.noteId)) continue
        const note = await db.notes.get(localNoteId)
        if (!note) continue

        const local = incoming.id ? await db.cards.get(incoming.id) : undefined
        if (local && local.updatedAt >= incoming.updatedAt) continue

        await db.cards.put({
          ...incoming,
          id: incoming.id || newId(),
          noteId: localNoteId,
          deckId: note.deckId,
          deletedAt: incoming.deletedAt ?? null,
          suspended: Boolean(incoming.suspended),
        })
        touchedCards.add(incoming.id)
        if (local) report.cardsRestored++
        else report.cardsCreated++
      }
    }

    // Notizen ohne Karten bekommen ihre Standardrichtungen.
    for (const { note, templateIds } of needCards) {
      const own = await db.cards.where('noteId').equals(note.id).toArray()
      const have = new Set(own.filter((c) => !c.deletedAt).map((c) => c.templateId))
      for (const templateId of templateIds) {
        if (have.has(templateId)) continue
        const revive = own.find((c) => c.templateId === templateId)
        if (revive) {
          await db.cards.put({ ...revive, deletedAt: null, updatedAt: now })
        } else {
          await db.cards.add({
            id: newId(),
            createdAt: note.createdAt,
            updatedAt: now,
            deletedAt: null,
            noteId: note.id,
            deckId: note.deckId,
            templateId,
            suspended: false,
            ...initialState(note.createdAt),
          })
        }
        report.cardsCreated++
      }
    }

    /* --- 4. Reviews vereinigen ------------------------------------- */
    if (includeProgress && file.reviews?.length) {
      const affected = new Set<ID>()
      for (const r of file.reviews) {
        if (!r.id || !r.cardId) continue
        if (merged.has(r.noteId)) continue
        const card = await db.cards.get(r.cardId)
        if (!card) continue
        if (await db.reviews.get(r.id)) continue
        const review: Review = {
          ...r,
          noteId: card.noteId,
          deckId: card.deckId,
          wasNew: Boolean(r.wasNew),
          typed: typeof r.typed === 'string' ? r.typed : '',
          verdict: r.verdict ?? 'manual',
        }
        await db.reviews.add(review)
        affected.add(r.cardId)
        report.reviewsImported++
      }
      for (const id of affected) touchedCards.add(id)
    }

    /* --- 5. Zustand aus dem Log neu berechnen ---------------------- *
     * Das ist die Absicherung: statt dem Kartenzustand aus der Datei zu
     * glauben, wird er aus dem vereinigten Review-Log rekonstruiert.     */
    for (const cardId of touchedCards) {
      const card = await db.cards.get(cardId)
      if (!card) continue
      const reviews = await db.reviews.where('cardId').equals(cardId).toArray()
      if (reviews.length === 0) continue
      const state = replay(card.createdAt, reviews)
      await db.cards.put({ ...card, ...state, updatedAt: now })
    }
  })

  return report
}

/* ------------------------------------------------------------------ *
 * CSV -> Notizen. Läuft danach durch denselben Importpfad.
 * ------------------------------------------------------------------ */

export interface RowMapping {
  /** Feldschlüssel -> Spaltenindex, -1 = nicht zuordnen. */
  fields: Record<string, number>
  /** Spalte mit Leerzeichen-getrennten Tags, -1 = keine. */
  tagsColumn: number
  skipFirstRow: boolean
}

export function rowsToNotes(
  rows: string[][],
  noteTypeId: NoteTypeId,
  mapping: RowMapping,
  deckId: ID,
): Note[] {
  const now = Date.now()
  const body = mapping.skipFirstRow ? rows.slice(1) : rows
  const out: Note[] = []

  for (const row of body) {
    const fields: Record<string, string> = {}
    for (const f of noteType(noteTypeId).fields) {
      const idx = mapping.fields[f.key] ?? -1
      fields[f.key] = idx >= 0 ? (row[idx] ?? '').trim() : ''
    }
    if (missingRequired(noteTypeId, fields).length > 0) continue

    const tags =
      mapping.tagsColumn >= 0
        ? (row[mapping.tagsColumn] ?? '')
            .split(/[\s,]+/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : []

    out.push({
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deckId,
      noteTypeId,
      fields,
      tags,
    })
  }
  return out
}

/** Vorschau: wie viele Zeilen sind verwertbar, wie viele Dubletten stecken drin. */
export async function previewRows(
  notes: Note[],
  deckId: ID,
): Promise<{ total: number; duplicatesInFile: number; alreadyKnown: number }> {
  const existing = await db.notes.where('deckId').equals(deckId).toArray()
  const known = new Set(
    existing.filter((n) => !n.deletedAt).map((n) => identityKey(n.deckId, n.noteTypeId, n.fields)),
  )
  const seen = new Set<string>()
  let duplicatesInFile = 0
  let alreadyKnown = 0

  for (const n of notes) {
    const key = identityKey(deckId, n.noteTypeId, n.fields)
    if (seen.has(key)) duplicatesInFile++
    else if (known.has(key)) alreadyKnown++
    seen.add(key)
  }
  return { total: notes.length, duplicatesInFile, alreadyKnown }
}

/** Baut aus Notizen eine Datei-Struktur, damit CSV denselben Weg nimmt. */
export function notesToFile(notes: Note[]): ExportFile {
  return {
    format: 'kartei',
    schemaVersion: 1,
    exportedAt: Date.now(),
    app: 'csv-import',
    includesProgress: false,
    decks: [],
    notes,
  }
}
