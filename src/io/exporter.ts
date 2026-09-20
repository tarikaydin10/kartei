import { db } from '@/data/db'
import type { ID } from '@/data/types'
import { FORMAT, SCHEMA_VERSION, type ExportFile } from './schema'
import { toCsv } from './csv'
import { noteType } from '@/domain/notetypes'

const APP = 'kartei/0.1.0'

export interface ExportOptions {
  /** `null` = alle Decks. */
  deckIds?: ID[] | null
  /** Karten und Reviews mitnehmen (Backup) oder nur Inhalt (Teilen)? */
  includeProgress: boolean
}

export async function buildExport(opts: ExportOptions): Promise<ExportFile> {
  const wanted = opts.deckIds && opts.deckIds.length > 0 ? new Set(opts.deckIds) : null

  const decks = (await db.decks.toArray()).filter((d) => !wanted || wanted.has(d.id))
  const notes = (await db.notes.toArray()).filter((n) => !wanted || wanted.has(n.deckId))
  const noteIds = new Set(notes.map((n) => n.id))

  const file: ExportFile = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    app: APP,
    includesProgress: opts.includeProgress,
    decks,
    notes,
  }

  if (opts.includeProgress) {
    file.cards = (await db.cards.toArray()).filter((c) => noteIds.has(c.noteId))
    file.reviews = (await db.reviews.toArray()).filter((r) => noteIds.has(r.noteId))
  }

  return file
}

export function exportFilename(file: ExportFile, label?: string): string {
  const d = new Date(file.exportedAt)
  const stamp = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
  const kind = file.includesProgress ? 'backup' : 'deck'
  const slug = (label ?? 'kartei')
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/^-|-$/g, '')
  return `kartei-${kind}-${slug || 'alle'}-${stamp}.json`
}

/** Notizen als CSV — zum Weiterbearbeiten in einer Tabelle. */
export async function buildCsv(deckIds?: ID[] | null): Promise<string> {
  const wanted = deckIds && deckIds.length > 0 ? new Set(deckIds) : null
  const notes = (await db.notes.toArray()).filter(
    (n) => !n.deletedAt && (!wanted || wanted.has(n.deckId)),
  )
  if (notes.length === 0) return ''

  const type = noteType(notes[0]!.noteTypeId)
  const keys = type.fields.map((f) => f.key)
  const rows: string[][] = [[...keys, 'tags']]
  for (const n of notes) {
    rows.push([...keys.map((k) => n.fields[k] ?? ''), n.tags.join(' ')])
  }
  return toCsv(rows)
}

/**
 * Datei ausgeben. Auf iOS ist der Share-Sheet der zuverlässige Weg (ein
 * `a[download]` landet dort im Nichts), auf dem Desktop der klassische
 * Download. Beides ausdrücklich vom Nutzer ausgelöst.
 */
export async function saveTextFile(
  content: string,
  filename: string,
  mime = 'application/json',
): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })

  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
    share?: (data: { files?: File[]; title?: string }) => Promise<void>
  }
  const file = new File([blob], filename, { type: blob.type })
  if (nav.canShare?.({ files: [file] }) && isIosLike()) {
    try {
      await nav.share!({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      // Abbruch durch den Nutzer ist kein Fehler — dann eben Download.
      if ((e as Error).name === 'AbortError') return 'shared'
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

function isIosLike(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
