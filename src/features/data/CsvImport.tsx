import { useEffect, useMemo, useState } from 'react'
import { detectDelimiter, guessMapping, looksLikeHeader, parseDelimited, type Delimiter } from '@/io/csv'
import { importExportFile, notesToFile, previewRows, rowsToNotes, type ImportReport, type RowMapping } from '@/io/importer'
import type { Deck, ID } from '@/data/types'
import { noteType } from '@/domain/notetypes'
import { Button } from '@/ui/primitives'
import { Label, SegmentedControl, Switch } from '@/ui/Field'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { cn } from '@/lib/cn'

const DELIMITER_OPTIONS: Array<{ value: Delimiter; label: string }> = [
  { value: ',', label: 'Komma' },
  { value: ';', label: 'Semikolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
]

export function CsvImportSheet({
  text,
  decks,
  onClose,
  onDone,
}: {
  text: string
  decks: Deck[]
  onClose: () => void
  onDone: (report: ImportReport) => void
}) {
  const toast = useToast()
  const [delimiter, setDelimiter] = useState<Delimiter>(() => detectDelimiter(text))
  const [deckId, setDeckId] = useState<ID>(decks[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter])
  const columns = useMemo(() => Math.max(0, ...rows.map((r) => r.length)), [rows])
  const deck = decks.find((d) => d.id === deckId)
  const type = noteType(deck?.noteTypeId ?? 'ru-vocab')

  const [skipFirstRow, setSkipFirstRow] = useState(() => looksLikeHeader(rows[0]))
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [tagsColumn, setTagsColumn] = useState(-1)

  /* Zuordnung neu raten, wenn sich Trennzeichen oder Zieltyp ändert. */
  useEffect(() => {
    setMapping(guessMapping(rows[0], type.fields.map((f) => f.key), columns))
    setSkipFirstRow(looksLikeHeader(rows[0]))
  }, [rows, columns, type])

  const rowMapping: RowMapping = { fields: mapping, tagsColumn, skipFirstRow }

  const notes = useMemo(
    () => (deckId ? rowsToNotes(rows, type.id, rowMapping, deckId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, type.id, mapping, tagsColumn, skipFirstRow, deckId],
  )

  const [preview, setPreview] = useState({ total: 0, duplicatesInFile: 0, alreadyKnown: 0 })
  useEffect(() => {
    if (!deckId) return
    let alive = true
    void previewRows(notes, deckId).then((p) => {
      if (alive) setPreview(p)
    })
    return () => {
      alive = false
    }
  }, [notes, deckId])

  const usableRows = skipFirstRow ? rows.length - 1 : rows.length
  const skipped = Math.max(0, usableRows - notes.length)
  // Ehrliche Zahl: Dubletten in der Datei und schon bekannte Karten erzeugen
  // keine neue Karte, sondern werden zusammengeführt.
  const willCreate = Math.max(0, notes.length - preview.duplicatesInFile - preview.alreadyKnown)
  const required = type.fields.filter((f) => f.required)
  const ready = deckId !== '' && required.every((f) => (mapping[f.key] ?? -1) >= 0) && notes.length > 0

  const run = async () => {
    setBusy(true)
    try {
      const report = await importExportFile(notesToFile(notes), { targetDeckId: deckId })
      onDone(report)
    } catch (e) {
      toast.show(`Import fehlgeschlagen: ${(e as Error).message}`, { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title="CSV zuordnen"
      footer={
        <div>
          <p className="num mb-2 text-center text-xs text-muted">
            {willCreate} {willCreate === 1 ? 'Karte wird' : 'Karten werden'} angelegt
            {preview.alreadyKnown > 0 && ` · ${preview.alreadyKnown} aktualisiert`}
            {preview.duplicatesInFile > 0 && ` · ${preview.duplicatesInFile} doppelt`}
            {skipped > 0 && ` · ${skipped} unbrauchbar`}
          </p>
          <Button variant="accent" block disabled={!ready || busy} onClick={() => void run()}>
            {busy ? 'Importiere…' : 'Importieren'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Vorschau der Rohdaten */}
        <div>
          <Label hint={`${rows.length} Zeilen, ${columns} Spalten erkannt`}>Datei</Label>
          <div className="overflow-x-auto rounded-md border border-line-soft bg-surface">
            <table className="w-full text-xs">
              <tbody>
                {rows.slice(0, 4).map((row, ri) => (
                  <tr key={ri} className="border-b border-line-soft last:border-0">
                    {Array.from({ length: columns }, (_, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          'max-w-40 truncate px-2.5 py-1.5',
                          ri === 0 && skipFirstRow ? 'text-faint italic' : 'text-muted',
                        )}
                      >
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <SegmentedControl
          label="Trennzeichen"
          value={delimiter}
          onChange={setDelimiter}
          options={DELIMITER_OPTIONS}
        />

        <div className="border-t border-line-soft">
          <Switch
            label="Erste Zeile ist eine Kopfzeile"
            checked={skipFirstRow}
            onChange={setSkipFirstRow}
          />
        </div>

        {decks.length > 1 && (
          <div>
            <Label>Ziel-Deck</Label>
            <select
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3.5 py-3 outline-none"
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.emoji} {d.name} — {noteType(d.noteTypeId).name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Spaltenzuordnung */}
        <div>
          <Label hint="Pflichtfelder sind mit * markiert.">Spalten zuordnen</Label>
          <div className="space-y-2">
            {type.fields.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-muted">
                  {f.label}
                  {f.required && <span className="text-bad"> *</span>}
                </span>
                <select
                  value={mapping[f.key] ?? -1}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))
                  }
                  className={cn(
                    'min-w-0 flex-1 rounded-sm border bg-surface px-2.5 py-2 text-sm outline-none',
                    f.required && (mapping[f.key] ?? -1) < 0 ? 'border-bad/50' : 'border-line',
                  )}
                >
                  <option value={-1}>— nicht zuordnen —</option>
                  {Array.from({ length: columns }, (_, i) => (
                    <option key={i} value={i}>
                      Spalte {i + 1}
                      {rows[0]?.[i] ? ` · ${truncate(rows[0][i]!)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm text-muted">Tags</span>
              <select
                value={tagsColumn}
                onChange={(e) => setTagsColumn(Number(e.target.value))}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2.5 py-2 text-sm outline-none"
              >
                <option value={-1}>— keine —</option>
                {Array.from({ length: columns }, (_, i) => (
                  <option key={i} value={i}>
                    Spalte {i + 1}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Ergebnis-Vorschau */}
        {notes.length > 0 && (
          <div className="rounded-md border border-line-soft bg-surface p-3.5">
            <p className="mb-2 text-xs font-medium text-faint">So sieht die erste Karte aus</p>
            {type.fields
              .filter((f) => (notes[0]!.fields[f.key] ?? '').trim())
              .map((f) => (
                <p key={f.key} className="text-sm">
                  <span className="text-faint">{f.label}: </span>
                  <span className={cn(f.lang === 'ru' && 'font-ru')}>{notes[0]!.fields[f.key]}</span>
                </p>
              ))}
          </div>
        )}

        {preview.duplicatesInFile > 0 && (
          <p className="text-xs text-warn">
            {preview.duplicatesInFile} Zeilen sind innerhalb der Datei doppelt — sie werden zu einer
            Karte zusammengefasst.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function truncate(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
