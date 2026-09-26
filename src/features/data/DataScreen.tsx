import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { db } from '@/data/db'
import { formatBytes, requestPersistence, storageState, type StorageState } from '@/lib/persist'
import { listDecks, saveSetting, totals } from '@/data/repo'
import type { AppSettings, ID } from '@/data/types'
import { buildCsv, buildExport, exportFilename, saveTextFile } from '@/io/exporter'
import { PRONUNCIATION_LEGEND } from '@/domain/pronounce'
import { useLocalVoice } from '@/lib/speech'
import { parseExportFile } from '@/io/schema'
import { importExportFile, type ImportReport } from '@/io/importer'
import { Button, Panel, SectionTitle } from '@/ui/primitives'
import { SegmentedControl, Stepper, Switch } from '@/ui/Field'
import { ConfirmSheet, Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { CsvImportSheet } from './CsvImport'

export function DataScreen({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const decks = useLiveQuery(() => listDecks(), [], [])
  const sums = useLiveQuery(() => totals(), [], {
    notes: 0,
    cards: 0,
    reviews: 0,
    mature: 0,
    young: 0,
    fresh: 0,
  })

  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [csvText, setCsvText] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [shareDeck, setShareDeck] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const ruVoice = useLocalVoice('ru')

  /* --- Export ------------------------------------------------------ */

  const exportBackup = async () => {
    setBusy(true)
    try {
      const file = await buildExport({ includeProgress: true })
      const how = await saveTextFile(JSON.stringify(file), exportFilename(file))
      await saveSetting('lastBackupAt', Date.now())
      toast.show(how === 'shared' ? 'Backup geteilt' : 'Backup heruntergeladen', { tone: 'ok' })
    } catch (e) {
      toast.show(`Export fehlgeschlagen: ${(e as Error).message}`, { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  const exportDeck = async (deckId: ID, name: string) => {
    setBusy(true)
    try {
      const file = await buildExport({ deckIds: [deckId], includeProgress: false })
      await saveTextFile(JSON.stringify(file), exportFilename(file, name))
      toast.show(`„${name}“ exportiert — ohne Lernfortschritt`, { tone: 'ok' })
      setShareDeck(false)
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    setBusy(true)
    try {
      const csv = await buildCsv(null)
      if (!csv) {
        toast.show('Nichts zu exportieren', { tone: 'bad' })
        return
      }
      await saveTextFile(csv, `kartei-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')
      toast.show('CSV exportiert', { tone: 'ok' })
    } finally {
      setBusy(false)
    }
  }

  /* --- Import ------------------------------------------------------ */

  const pickFile = () => fileInput.current?.click()

  const onFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || !text.trimStart().startsWith('{')
      if (isCsv && !text.trimStart().startsWith('[')) {
        setCsvText(text)
        return
      }
      const parsed = parseExportFile(text)
      if (!parsed.ok) {
        toast.show(parsed.error, { tone: 'bad' })
        return
      }
      const result = await importExportFile(parsed.file)
      setReport(result)
    } catch (e) {
      toast.show(`Import fehlgeschlagen: ${(e as Error).message}`, { tone: 'bad' })
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const loadStarter = async () => {
    setBusy(true)
    try {
      const res = await fetch('/starter-ru.json')
      if (!res.ok) throw new Error('Starterdeck nicht gefunden')
      const parsed = parseExportFile(await res.json())
      if (!parsed.ok) throw new Error(parsed.error)
      setReport(await importExportFile(parsed.file))
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  /* --- Render ------------------------------------------------------ */

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 pb-4">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Daten &amp; Einstellungen</h1>

      {/* Sichern */}
      <SectionTitle>Sichern</SectionTitle>
      <Panel className="divide-y divide-line-soft overflow-hidden">
        <ActionRow
          icon={<HardDriveDownload className="size-[18px]" />}
          title="Backup exportieren"
          body="Alles inklusive Lernfortschritt. Für Gerätewechsel und als Sicherheitsnetz."
          onClick={exportBackup}
          disabled={busy}
        />
        <ActionRow
          icon={<Share2 className="size-[18px]" />}
          title="Deck teilen"
          body="Nur die Inhalte, ohne deinen Fortschritt."
          onClick={() => setShareDeck(true)}
          disabled={busy || decks.length === 0}
        />
        <ActionRow
          icon={<FileSpreadsheet className="size-[18px]" />}
          title="Als CSV exportieren"
          body="Zum Weiterbearbeiten in einer Tabelle."
          onClick={exportCsv}
          disabled={busy}
        />
      </Panel>
      <p className="num mt-2 px-1 text-[11px] text-faint">
        {settings.lastBackupAt
          ? `Letztes Backup: ${new Date(settings.lastBackupAt).toLocaleDateString('de-DE')}`
          : 'Noch kein Backup gemacht.'}{' '}
        · {sums.notes} Notizen, {sums.cards} Karten
      </p>

      {/* Importieren */}
      <div className="mt-6">
        <SectionTitle>Importieren</SectionTitle>
        <Panel className="divide-y divide-line-soft overflow-hidden">
          <ActionRow
            icon={<Upload className="size-[18px]" />}
            title="Datei importieren"
            body="JSON-Backup oder CSV/TSV. Bekannte Karten werden aktualisiert, keine Dubletten."
            onClick={pickFile}
            disabled={busy}
          />
          <ActionRow
            icon={<Sparkles className="size-[18px]" />}
            title="Starterdeck laden"
            body="Rund 100 russische Grundwörter mit Betonung und Beispielsatz."
            onClick={loadStarter}
            disabled={busy}
          />
        </Panel>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.csv,.tsv,.txt,application/json,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />
      </div>

      {/* Lernen */}
      <div className="mt-6">
        <SectionTitle>Lernen</SectionTitle>
        <Panel className="px-4">
          <Stepper
            label="Tagesziel"
            hint="Antworten pro Tag, ab denen der Tag für den Streak zählt."
            value={settings.dailyGoal}
            onChange={(v) => void saveSetting('dailyGoal', v)}
            min={5}
            max={300}
            step={5}
          />
          <div className="border-t border-line-soft" />
          <Stepper
            label="Neue Karten pro Tag"
            hint="Zu viele neue Karten heute sind morgen viele Wiederholungen."
            value={settings.newPerDay}
            onChange={(v) => void saveSetting('newPerDay', v)}
            min={0}
            max={100}
            step={5}
          />
          <div className="border-t border-line-soft py-3">
            <SegmentedControl
              label="Sessionlänge"
              value={settings.sessionSize}
              onChange={(v) => void saveSetting('sessionSize', v)}
              options={[
                { value: 10, label: 'Kurz · 10' },
                { value: 20, label: 'Normal · 20' },
                { value: 40, label: 'Lang · 40' },
              ]}
            />
          </div>
        </Panel>
      </div>

      {/* Antworten */}
      <div className="mt-6">
        <SectionTitle>Antworten prüfen</SectionTitle>
        <Panel className="divide-y divide-line-soft px-4">
          <Switch
            label="ё wie е behandeln"
            hint="Russische Texte schreiben meist е statt ё."
            checked={settings.ignoreYo}
            onChange={(v) => void saveSetting('ignoreYo', v)}
          />
          <Switch
            label="Groß-/Kleinschreibung ignorieren"
            checked={settings.ignoreCase}
            onChange={(v) => void saveSetting('ignoreCase', v)}
          />
          <Switch
            label="Falsches einmal abtippen"
            hint="Die richtige Antwort selbst zu schreiben prägt sie deutlich besser ein."
            checked={settings.retypeOnWrong}
            onChange={(v) => void saveSetting('retypeOnWrong', v)}
          />
          <Switch
            label="Kyrillische Bildschirmtastatur"
            hint="ЙЦУКЕН in der App, statt die Systemtastatur umzustellen."
            checked={settings.cyrillicKeyboard}
            onChange={(v) => void saveSetting('cyrillicKeyboard', v)}
          />
        </Panel>
      </div>

      {/* Aussprache */}
      <div className="mt-6">
        <SectionTitle>Aussprache</SectionTitle>
        <Panel className="px-4">
          <Switch
            label="Aussprache anzeigen"
            hint="Lautschrift zu russischen Wörtern, Beispielsätzen und Grammatikformen — beim Lernen, in der Deckliste und im Editor, überall dort, wo die Betonung markiert ist oder feststeht."
            checked={settings.showPronunciation}
            onChange={(v) => void saveSetting('showPronunciation', v)}
          />
        </Panel>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-faint">
          {PRONUNCIATION_LEGEND}.{' '}
          {ruVoice
            ? `Vorlesen mit der Gerätestimme „${ruVoice.name}“.`
            : 'Vorlesen gibt es, sobald das Gerät eine lokale russische Stimme hat — Online-Stimmen nutzt Kartei bewusst nicht.'}
        </p>
      </div>

      {/* Rückmeldung */}
      <div className="mt-6">
        <SectionTitle>Rückmeldung</SectionTitle>
        <Panel className="divide-y divide-line-soft px-4">
          <Switch
            label="Vibration"
            checked={settings.haptics}
            onChange={(v) => void saveSetting('haptics', v)}
          />
          <Switch
            label="Töne"
            checked={settings.sound}
            onChange={(v) => void saveSetting('sound', v)}
          />
        </Panel>
      </div>

      {/* Gefahrenzone */}
      <div className="mt-6">
        <SectionTitle>Zurücksetzen</SectionTitle>
        <Panel className="overflow-hidden">
          <ActionRow
            icon={<Trash2 className="size-[18px] text-bad" />}
            title="Alle Daten löschen"
            body="Decks, Karten und Verlauf auf diesem Gerät. Nicht umkehrbar."
            onClick={() => setConfirmWipe(true)}
            disabled={busy}
          />
        </Panel>
        <StorageNote />
      </div>

      {/* Sheets */}
      <Sheet open={shareDeck} onClose={() => setShareDeck(false)} title="Welches Deck?">
        <div className="space-y-1.5">
          {decks.map((d) => (
            <button
              key={d.id}
              onClick={() => void exportDeck(d.id, d.name)}
              className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3 text-left hover:bg-surface-2"
            >
              <span>{d.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <Download className="size-4 text-faint" />
            </button>
          ))}
        </div>
      </Sheet>

      {csvText !== null && (
        <CsvImportSheet
          text={csvText}
          decks={decks}
          onClose={() => setCsvText(null)}
          onDone={(r) => {
            setCsvText(null)
            setReport(r)
          }}
        />
      )}

      <ImportReportSheet report={report} onClose={() => setReport(null)} />

      <ConfirmSheet
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={async () => {
          await db.delete()
          location.reload()
        }}
        title="Wirklich alles löschen?"
        body="Sämtliche Decks, Karten und der komplette Lernverlauf werden entfernt. Das lässt sich nur aus einem Backup zurückholen."
        confirmLabel="Alles löschen"
      />
    </div>
  )
}

/**
 * Zeigt, ob der Browser den Speicher dieser Origin als dauerhaft führt.
 * Wichtig genug, um sichtbar zu sein — und ehrlich genug zu sagen, dass das
 * Backup die eigentliche Absicherung bleibt.
 */
function StorageNote() {
  const [state, setState] = useState<StorageState | null>(null)
  const [asking, setAsking] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void storageState().then(setState)
  }, [])

  const ask = async () => {
    setAsking(true)
    const ok = await requestPersistence()
    setState(await storageState())
    setAsking(false)
    toast.show(
      ok
        ? 'Speicher ist jetzt dauerhaft'
        : 'Der Browser hat abgelehnt — meist hilft es, die App auf den Homescreen zu legen.',
      { tone: ok ? 'ok' : 'bad' },
    )
  }

  return (
    <div className="mt-3 px-1">
      {state && (
        <p className="num mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={state.persisted ? 'text-ok' : 'text-warn'}>
            {state.persisted ? '● Speicher dauerhaft' : '● Speicher nicht garantiert'}
          </span>
          <span className="text-faint">
            {formatBytes(state.usageBytes)} belegt
            {state.quotaBytes ? ` von ${formatBytes(state.quotaBytes)}` : ''}
          </span>
          {state.supported && !state.persisted && (
            <button
              onClick={() => void ask()}
              disabled={asking}
              className="text-accent-2 underline decoration-dotted"
            >
              anfordern
            </button>
          )}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-faint">
        Kartei speichert alles nur lokal auf diesem Gerät. Nichts wird übertragen. Browser-Speicher
        hängt an der Adresse der App und ist ohne die Zusage oben nur „nach Möglichkeit“ dauerhaft —
        deshalb ist das Backup die eigentliche Absicherung, bis die Synchronisierung steht.
      </p>
    </div>
  )
}

function ActionRow({
  icon,
  title,
  body,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  title: string
  body: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-40"
    >
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-faint">{body}</span>
      </span>
    </button>
  )
}

function ImportReportSheet({
  report,
  onClose,
}: {
  report: ImportReport | null
  onClose: () => void
}) {
  if (!report) return null
  const all: Array<[string, number]> = [
    ['Neue Karten', report.notesCreated],
    ['Aktualisiert', report.notesUpdated],
    ['Unverändert', report.notesUnchanged],
    ['Neue Decks', report.decksCreated],
    ['Lernrichtungen angelegt', report.cardsCreated],
    ['Fortschritt übernommen', report.reviewsImported],
  ]
  const rows = all.filter(([, v]) => v > 0)

  return (
    <Sheet
      open
      onClose={onClose}
      title="Import fertig"
      footer={
        <Button variant="accent" block onClick={onClose}>
          Alles klar
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nichts geändert — die Datei war bereits vollständig vorhanden. Genau so soll ein zweiter
          Import auch aussehen.
        </p>
      ) : (
        <div className="divide-y divide-line-soft">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-muted">{label}</span>
              <span className="num text-[15px] font-semibold">{value}</span>
            </div>
          ))}
        </div>
      )}

      {report.problems.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-warn">
            {report.problems.length} Zeilen übersprungen
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line-soft bg-surface p-3">
            {report.problems.slice(0, 40).map((p, i) => (
              <li key={i} className="text-[11px] leading-snug text-faint">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
