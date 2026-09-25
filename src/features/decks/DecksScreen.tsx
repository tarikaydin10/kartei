import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Layers, Plus } from 'lucide-react'
import { countsByDeck, createDeck, listDecks } from '@/data/repo'
import type { AppSettings, Deck, ID } from '@/data/types'
import { NOTE_TYPE_LIST } from '@/domain/notetypes'
import type { NoteTypeId } from '@/data/types'
import { Badge, Button, Empty, Panel, SectionTitle } from '@/ui/primitives'
import { Input } from '@/ui/Field'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { cn } from '@/lib/cn'
import { DeckDetail } from './DeckDetail'

export function DecksScreen({
  settings,
  onStudy,
  onMore,
  openDeckId,
  setOpenDeckId,
}: {
  settings: AppSettings
  onStudy: (deckId: ID) => void
  onMore: (deckId: ID) => void
  openDeckId: ID | null
  setOpenDeckId: (id: ID | null) => void
}) {
  const decks = useLiveQuery(() => listDecks(), [], [])
  const perDeck = useLiveQuery(() => countsByDeck(), [], new Map())
  const [creating, setCreating] = useState(false)

  const open = decks.find((d) => d.id === openDeckId)
  if (openDeckId && open) {
    return (
      <DeckDetail
        deck={open}
        decks={decks}
        settings={settings}
        onBack={() => setOpenDeckId(null)}
        onStudy={onStudy}
        onMore={onMore}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Decks</h1>
        <Button variant="surface" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Neu
        </Button>
      </div>

      {decks.length === 0 ? (
        <Empty
          icon={<Layers className="size-8" />}
          title="Noch kein Deck"
          body="Ein Deck ist ein Thema. Mit einem anfangen reicht — weitere kommen später dazu."
          action={
            <Button variant="accent" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Deck anlegen
            </Button>
          }
        />
      ) : (
        <>
          <SectionTitle>{decks.length} Decks</SectionTitle>
          <Panel className="divide-y divide-line-soft overflow-hidden">
            {decks.map((deck) => {
              const c = perDeck.get(deck.id) ?? { due: 0, fresh: 0, learning: 0, total: 0 }
              return (
                <button
                  key={deck.id}
                  onClick={() => setOpenDeckId(deck.id)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="text-xl leading-none">{deck.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{deck.name}</span>
                    <span className="num block text-xs text-faint">
                      {c.total} Karten · {c.fresh} neu
                    </span>
                  </span>
                  {c.due > 0 && <Badge tone="accent">{c.due} fällig</Badge>}
                </button>
              )
            })}
          </Panel>
        </>
      )}

      <NewDeckSheet open={creating} onClose={() => setCreating(false)} onOpen={setOpenDeckId} />
    </div>
  )
}

function NewDeckSheet({
  open,
  onClose,
  onOpen,
}: {
  open: boolean
  onClose: () => void
  onOpen: (id: ID) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🗂️')
  const [noteTypeId, setNoteTypeId] = useState<NoteTypeId>('ru-vocab')

  const create = async () => {
    const deck: Deck = await createDeck(name, { emoji, noteTypeId })
    toast.show(`Deck „${deck.name}“ angelegt`, { tone: 'ok' })
    setName('')
    setEmoji('🗂️')
    onClose()
    onOpen(deck.id)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Neues Deck"
      footer={
        <Button variant="accent" block disabled={!name.trim()} onClick={() => void create()}>
          Anlegen
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
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Russisch Grundwortschatz"
              autoFocus
            />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-muted">Kartentyp</p>
          <div className="space-y-1.5">
            {NOTE_TYPE_LIST.map((t) => (
              <button
                key={t.id}
                onClick={() => setNoteTypeId(t.id)}
                className={cn(
                  'w-full rounded-md border px-3.5 py-3 text-left transition-colors',
                  noteTypeId === t.id ? 'border-accent/40 bg-accent-dim' : 'border-line bg-surface',
                )}
              >
                <span className="block text-[15px] font-medium">{t.name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-faint">{t.description}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">
            Der Kartentyp bleibt fest — er bestimmt Felder und Lernrichtungen des Decks.
          </p>
        </div>
      </div>
    </Sheet>
  )
}
