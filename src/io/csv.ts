/**
 * Minimaler, korrekter CSV/TSV-Parser. Kein Paket dafür — der Standardfall
 * (Anführungszeichen, doppelte Anführungszeichen, CRLF, Zeilenumbrüche im Feld)
 * sind knapp fünfzig Zeilen.
 *
 * Die meisten Vokabellisten der Welt liegen als CSV oder TSV vor. Deshalb ist
 * das ein Erstklassen-Importweg und kein Nachgedanke.
 */

export const DELIMITERS = [',', ';', '\t', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]

/** Ratet das Trennzeichen aus den ersten Zeilen: das mit der stabilsten Spaltenzahl. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20)
  if (sample.length === 0) return ','

  let best: Delimiter = ','
  let bestScore = -1
  for (const d of DELIMITERS) {
    const counts = sample.map((l) => countOutsideQuotes(l, d))
    const max = Math.max(...counts)
    if (max === 0) continue
    const consistent = counts.filter((c) => c === max).length / counts.length
    const score = consistent * 10 + Math.min(max, 6)
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let n = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch === delimiter) n++
  }
  return n
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text)
  // BOM entfernen — Excel-Exporte tragen sie ständig mit.
  const src = text.replace(/^﻿/, '')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // Leere Zeilen überspringen.
    if (row.length > 1 || row[0]!.trim() !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === d) {
      endField()
    } else if (ch === '\n') {
      endRow()
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      endRow()
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) endRow()

  return rows.map((r) => r.map((c) => c.trim()))
}

export function toCsv(rows: string[][], delimiter = ','): string {
  const esc = (v: string) =>
    /["\n\r]|^\s|\s$/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n')
}

/**
 * Spaltenzuordnung raten. Erkennt eine Kopfzeile an bekannten Bezeichnungen
 * und schlägt sonst nach Position vor.
 */
const HEADER_HINTS: Record<string, string[]> = {
  ru: ['ru', 'russisch', 'russian', 'слово', 'русский', 'wort', 'front', 'vorne'],
  de: ['de', 'deutsch', 'german', 'übersetzung', 'ubersetzung', 'перевод', 'back', 'hinten'],
  grammatik: ['grammatik', 'grammar', 'genus', 'pos', 'wortart'],
  beispielRu: ['beispiel ru', 'beispielru', 'example ru', 'пример', 'satz'],
  beispielDe: ['beispiel de', 'beispielde', 'example de', 'beispiel übersetzung'],
  notiz: ['notiz', 'note', 'notes', 'kommentar', 'примечание'],
  tags: ['tags', 'tag', 'kategorie', 'kategorien'],
}

export function looksLikeHeader(row: string[] | undefined): boolean {
  if (!row) return false
  const cells = row.map((c) => c.toLowerCase().trim())
  return cells.some((c) => Object.values(HEADER_HINTS).some((hints) => hints.includes(c)))
}

/** Liefert je Zielfeld den Spaltenindex (oder -1 für „nicht zuordnen“). */
export function guessMapping(header: string[] | undefined, fieldKeys: string[], columns: number): Record<string, number> {
  const mapping: Record<string, number> = {}
  const used = new Set<number>()

  if (header && looksLikeHeader(header)) {
    for (const key of fieldKeys) {
      const hints = HEADER_HINTS[key] ?? [key.toLowerCase()]
      const idx = header.findIndex(
        (h, i) => !used.has(i) && hints.includes(h.toLowerCase().trim()),
      )
      if (idx >= 0) {
        mapping[key] = idx
        used.add(idx)
      }
    }
  }

  // Nicht zugeordnete Pflichtfelder nach Position auffüllen.
  for (const key of fieldKeys) {
    if (mapping[key] !== undefined) continue
    const free = Array.from({ length: columns }, (_, i) => i).find((i) => !used.has(i))
    if (free !== undefined && Object.keys(mapping).length < 2) {
      mapping[key] = free
      used.add(free)
    } else {
      mapping[key] = -1
    }
  }
  return mapping
}
