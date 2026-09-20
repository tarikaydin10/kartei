import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronLeft,
  CheckSquare,
  FolderInput,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import {
  cardsOfNote,
  countsFor,
  deleteDeck,
  deleteNotes,
  listNotes,
  moveNotes,
  setSuspended,
  updateDeck,
} from '@/data/repo'
import type { AppSettings, Deck, ID, Note } from '@/data/types'
import { noteType } from '@/domain/notetypes'
import { normalize } from '@/domain/answer'
import { dueLabel } from '@/lib/date'
import { cn } from '@/lib/cn'
import { Badge, Button, Empty, Panel, Stat } from '@/ui/primitives'
import { Input, Stepper } from '@/ui/Field'
import { ConfirmSheet, Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { NoteEditor } from './NoteEditor'

const PAGE = 100

export function DeckDetail({
  deck,
  decks,
  settings,
  onBack,
  onStudy,
}: {
  deck: Deck
  decks: Deck[]
  settings: AppSettings
  onBack: () => void
  onStudy: (deckId: ID) => void
}) {
  const toast = useToast()
  const notes = useLiveQuery(() => listNotes(deck.id), [deck.id], [])
  const counts = useLiveQuery(() => countsFor(deck.id), [deck.id], {
    due: 0,
    fresh: 0,
    learning: 0,
    total: 0,
  })

  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<ID>>(new Set())
  const [editing, setEditing] = useState<ID | null>(null)
  const [creating, setCreating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [confirmDeleteDeck, setConfirmDeleteDeck] = useState(false)
  const [confirmDeleteNotes, setConfirmDeleteNotes] = useState(false)

  const type = noteType(deck.noteTypeId)

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return notes
    return notes.filter((n) =>
      Object.values(n.fields).some((v) => normalize(v).includes(q)) ||
      n.tags.some((t) => t.includes(q)),
    )
  }, [notes, query])

  const visible = filtered.slice(0, limit)

  const toggle = (id: ID) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exitSelection = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3">
      {/* Kopf */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Zurück"
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          <span className="mr-1.5">{deck.emoji}</span>
          {deck.name}
        </h1>
        <button
          onClick={() => setShowSettings(true)}
          aria-label="Deck-Einstellungen"
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
        >
          <MoreVertical className="size-5" />
        </button>
      </div>

      {/* Zahlen + Lernen */}
      <Panel className="mt-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <Stat label="fällig" value={counts.due} tone={counts.due > 0 ? 'accent' : undefined} />
          <Stat label="neu" value={counts.fresh} />
          <Stat label="im Lernen" value={counts.learning} />
          <Stat label="Karten" value={counts.total} />
        </div>
        <Button
          variant="accent"
          block
          className="mt-4"
          disabled={counts.due + counts.fresh === 0}
          onClick={() => onStudy(deck.id)}
        >
          <Play className="size-4" /> Lernen
        </Button>
      </Panel>

      {/* Suche und Aktionen */}
      <div className="mt-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            placeholder="Suchen…"
            aria-label="Karten durchsuchen"
            className="w-full rounded-md border border-line bg-surface py-2.5 pr-3 pl-9 text-[15px] outline-none focus:border-accent/60"
          />
        </div>
        <Button
          variant={selecting ? 'accent' : 'surface'}
          size="md"
          onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          aria-label="Mehrere auswählen"
        >
          <CheckSquare className="size-4" />
        </Button>
        <Button variant="surface" onClick={() => setCreating(true)} aria-label="Karte anlegen">
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Auswahl-Aktionsleiste */}
      {selecting && (
        <div className="animate-rise mt-2 flex items-center gap-2 rounded-md border border-accent/30 bg-accent-dim px-3 py-2">
          <span className="num text-sm text-accent-2">{selected.size} ausgewählt</span>
          <span className="flex-1" />
          <button
            onClick={() => setSelected(new Set(filtered.map((n) => n.id)))}
            className="rounded-xs px-2 py-1 text-xs text-muted hover:text-text"
          >
            alle
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => setShowMove(true)}
            aria-label="Verschieben"
            className="grid size-8 place-items-center rounded-xs text-muted hover:text-text disabled:opacity-30"
          >
            <FolderInput className="size-4" />
          </button>
          <button
            disabled={selected.size === 0}
            onClick={async () => {
              await setSuspended([...selected], true)
              toast.show(`${selected.size} pausiert`, { tone: 'ok' })
              exitSelection()
            }}
            aria-label="Pausieren"
            className="grid size-8 place-items-center rounded-xs text-muted hover:text-text disabled:opacity-30"
          >
            <Pause className="size-4" />
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => setConfirmDeleteNotes(true)}
            aria-label="Löschen"
            className="grid size-8 place-items-center rounded-xs text-bad hover:bg-bad/10 disabled:opacity-30"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      {/* Liste */}
      {filtered.length === 0 ? (
        <Empty
          title={query ? 'Nichts gefunden' : 'Deck ist leer'}
          body={
            query
              ? 'Andere Schreibweise probieren — die Suche ignoriert Betonung und Groß-/Kleinschreibung.'
              : 'Leg die erste Karte an oder importiere eine Liste.'
          }
          action={
            !query && (
              <Button variant="accent" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Karte anlegen
              </Button>
            )
          }
        />
      ) : (
        <>
          <Panel className="mt-3 divide-y divide-line-soft overflow-hidden">
            {visible.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                primaryKey={type.primaryField}
                secondaryKey={type.secondaryField}
                selecting={selecting}
                selected={selected.has(note.id)}
                onPress={() => (selecting ? toggle(note.id) : setEditing(note.id))}
              />
            ))}
          </Panel>
          {filtered.length > visible.length && (
            <Button
              variant="ghost"
              block
              className="mt-2"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Weitere {Math.min(PAGE, filtered.length - visible.length)} anzeigen
            </Button>
          )}
          <p className="num mt-2 px-1 text-center text-[11px] text-faint">
            {filtered.length} von {notes.length} Karten
          </p>
        </>
      )}

      {/* Sheets */}
      <NoteEditor
        open={creating}
        onClose={() => setCreating(false)}
        deck={deck}
        decks={decks}
        settings={settings}
      />
      <NoteEditor
        open={editing !== null}
        onClose={() => setEditing(null)}
        deck={deck}
        decks={decks}
        noteId={editing}
        settings={settings}
      />

      <DeckSettingsSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        deck={deck}
        defaultNewPerDay={settings.newPerDay}
        onDelete={() => {
          setShowSettings(false)
          setConfirmDeleteDeck(true)
        }}
      />

      <Sheet open={showMove} onClose={() => setShowMove(false)} title="Verschieben nach">
        <div className="space-y-1.5">
          {decks
            .filter((d) => d.id !== deck.id && d.noteTypeId === deck.noteTypeId)
            .map((d) => (
              <button
                key={d.id}
                onClick={async () => {
                  await moveNotes([...selected], d.id)
                  toast.show(`${selected.size} verschoben nach ${d.name}`, { tone: 'ok' })
                  setShowMove(false)
                  exitSelection()
                }}
                className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3 text-left hover:bg-surface-2"
              >
                <span>{d.emoji}</span>
                <span className="flex-1 truncate">{d.name}</span>
              </button>
            ))}
          {decks.filter((d) => d.id !== deck.id && d.noteTypeId === deck.noteTypeId).length === 0 && (
            <p className="text-sm text-muted">
              Es gibt kein anderes Deck mit demselben Kartentyp. Leg zuerst eins an.
            </p>
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDeleteNotes}
        onClose={() => setConfirmDeleteNotes(false)}
        onConfirm={async () => {
          const n = selected.size
          await deleteNotes([...selected])
          toast.show(`${n} gelöscht`, { tone: 'ok' })
          exitSelection()
        }}
        title={`${selected.size} Karten löschen?`}
        body="Der Lernfortschritt dieser Karten geht mit. Ein vorheriger Export bringt sie zurück."
      />

      <ConfirmSheet
        open={confirmDeleteDeck}
        onClose={() => setConfirmDeleteDeck(false)}
        onConfirm={async () => {
          await deleteDeck(deck.id)
          toast.show(`Deck „${deck.name}“ gelöscht`, { tone: 'ok' })
          onBack()
        }}
        title={`Deck „${deck.name}“ löschen?`}
        body={`${counts.total} Karten samt Fortschritt werden entfernt.`}
        confirmLabel="Deck löschen"
      />
    </div>
  )
}

function NoteRow({
  note,
  primaryKey,
  secondaryKey,
  selecting,
  selected,
  onPress,
}: {
  note: Note
  primaryKey: string
  secondaryKey: string
  selecting: boolean
  selected: boolean
  onPress: () => void
}) {
  const cards = useLiveQuery(() => cardsOfNote(note.id), [note.id], [])
  const soonest = cards.length
    ? cards.reduce((min, c) => (c.due < min ? c.due : min), cards[0]!.due)
    : null
  const anySuspended = cards.some((c) => c.suspended)
  const anyNew = cards.some((c) => c.state === 0)

  return (
    <button
      onClick={onPress}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2',
        selected && 'bg-accent-dim',
      )}
    >
      {selecting && (
        <span
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-[5px] border text-[11px]',
            selected ? 'border-accent bg-accent text-ink' : 'border-line',
          )}
        >
          {selected && '✓'}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="font-ru block truncate text-[15px] font-medium">
          {note.fields[primaryKey] || '—'}
        </span>
        <span className="block truncate text-[13px] text-muted">
          {note.fields[secondaryKey]?.replace(/\|/g, ' · ') || '—'}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {anySuspended ? (
          <Badge tone="muted">pausiert</Badge>
        ) : anyNew ? (
          <Badge tone="accent">neu</Badge>
        ) : (
          soonest !== null && <span className="num text-[11px] text-faint">{dueLabel(soonest)}</span>
        )}
      </span>
    </button>
  )
}

function DeckSettingsSheet({
  open,
  onClose,
  deck,
  defaultNewPerDay,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  deck: Deck
  defaultNewPerDay: number
  onDelete: () => void
}) {
  const [name, setName] = useState(deck.name)
  const [emoji, setEmoji] = useState(deck.emoji)
  const [newPerDay, setNewPerDay] = useState(deck.newPerDay)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Deck"
      footer={
        <Button
          variant="accent"
          block
          onClick={async () => {
            await updateDeck(deck.id, { name: name.trim() || deck.name, emoji, newPerDay })
            onClose()
          }}
        >
          Speichern
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="w-20">
            <Input
              label="Icon"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              className="text-center text-xl"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <Stepper
          label="Neue Karten pro Tag"
          hint={
            newPerDay === 0
              ? `Standard verwenden (${defaultNewPerDay} pro Tag)`
              : 'Nur für dieses Deck'
          }
          value={newPerDay}
          onChange={setNewPerDay}
          min={0}
          max={200}
          step={5}
        />

        <p className="text-xs text-faint">
          Kartentyp: {noteType(deck.noteTypeId).name} — beim Anlegen festgelegt und nicht
          wechselbar, damit bestehende Karten nicht zerfallen.
        </p>

        <button
          onClick={onDelete}
          className="flex w-full items-center gap-2 rounded-md border border-bad/30 bg-bad-dim px-3.5 py-3 text-sm text-bad"
        >
          <Trash2 className="size-4" /> Deck löschen
        </button>
      </div>
    </Sheet>
  )
}
