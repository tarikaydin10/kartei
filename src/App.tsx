import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, House, Layers, SlidersHorizontal } from 'lucide-react'
import { ensureDeviceId, ensureSeed, listDecks, type StudyRequest } from '@/data/repo'
import { useSettings } from '@/data/useSettings'
import type { ID } from '@/data/types'
import { cn } from '@/lib/cn'
import { requestPersistence } from '@/lib/persist'
import { ToastProvider } from '@/ui/Toast'
import { Spinner } from '@/ui/primitives'
import { TodayScreen } from '@/features/today/TodayScreen'
import { DecksScreen } from '@/features/decks/DecksScreen'
import { NoteEditor } from '@/features/decks/NoteEditor'
import { StatsScreen } from '@/features/stats/StatsScreen'
import { DataScreen } from '@/features/data/DataScreen'
import { StudyScreen } from '@/features/study/StudyScreen'
import { StudyOptionsSheet } from '@/features/study/StudyOptions'

type Tab = 'today' | 'decks' | 'stats' | 'data'

const TABS: Array<{ id: Tab; label: string; Icon: typeof House }> = [
  { id: 'today', label: 'Heute', Icon: House },
  { id: 'decks', label: 'Decks', Icon: Layers },
  { id: 'stats', label: 'Statistik', Icon: BarChart3 },
  { id: 'data', label: 'Daten', Icon: SlidersHorizontal },
]

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const settings = useSettings()
  const decks = useLiveQuery(() => listDecks(), [], undefined)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('today')
  const [openDeckId, setOpenDeckId] = useState<ID | null>(null)
  const [study, setStudy] = useState<{ request: StudyRequest; run: number } | null>(null)
  /** Offene Auswahl „Mehr lernen“ für ein Deck (`null` = alle). */
  const [more, setMore] = useState<{ deckId: ID | null } | null>(null)
  const [quickAdd, setQuickAdd] = useState(false)
  const runs = useRef(0)

  /* Jede Session bekommt einen eigenen Schlüssel — „Nochmal üben“ baut eine
     frische Session, statt die laufende umzubauen. */
  const startStudy = useCallback((request: StudyRequest) => {
    runs.current += 1
    setMore(null)
    setStudy({ request, run: runs.current })
  }, [])
  const studyPlan = useCallback((deckId: ID | null) => startStudy({ deckId, mode: 'due' }), [startStudy])
  const openMore = useCallback((deckId: ID | null) => setMore({ deckId }), [])

  useEffect(() => {
    void (async () => {
      await ensureDeviceId()
      await ensureSeed()
      setReady(true)
      // Bittet den Browser, diese Origin nicht unter Speicherdruck zu räumen.
      // Darf scheitern — der Export bleibt die eigentliche Absicherung.
      void requestPersistence()
    })()
  }, [])

  if (!ready || decks === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <Spinner />
      </div>
    )
  }

  const deckName = (id: ID | null) => (id ? decks.find((d) => d.id === id)?.name : null) ?? 'Alle Decks'

  const moreSheet = (
    <StudyOptionsSheet
      open={more !== null}
      onClose={() => setMore(null)}
      deckId={more?.deckId ?? null}
      deckName={deckName(more?.deckId ?? null)}
      settings={settings}
      onStart={startStudy}
    />
  )

  /* Die Lernsession übernimmt den ganzen Bildschirm — keine Navigation,
     keine Zahlen, keine Ablenkung. */
  if (study) {
    return (
      <>
        <StudyScreen
          key={study.run}
          request={study.request}
          deckName={deckName(study.request.deckId)}
          settings={settings}
          onExit={() => setStudy(null)}
          onRestart={startStudy}
          onMore={() => openMore(study.request.deckId)}
        />
        {moreSheet}
      </>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink" style={{ paddingTop: 'var(--safe-t)' }}>
      <main className="flex-1 pb-24">
        {tab === 'today' && (
          <TodayScreen
            settings={settings}
            onStudy={studyPlan}
            onMore={openMore}
            onAddCard={() => setQuickAdd(true)}
            onOpenDeck={(id) => {
              setOpenDeckId(id)
              setTab('decks')
            }}
            onOpenData={() => setTab('data')}
          />
        )}

        {tab === 'decks' && (
          <DecksScreen
            settings={settings}
            onStudy={studyPlan}
            onMore={openMore}
            openDeckId={openDeckId}
            setOpenDeckId={setOpenDeckId}
          />
        )}

        {tab === 'stats' && <StatsScreen settings={settings} />}
        {tab === 'data' && <DataScreen settings={settings} />}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-ink-2/90 backdrop-blur-lg"
        style={{ paddingBottom: 'var(--safe-b)' }}
      >
        <div className="mx-auto flex max-w-xl">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => {
                  setTab(id)
                  if (id !== 'decks') setOpenDeckId(null)
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors duration-150',
                  active ? 'text-accent-2' : 'text-faint hover:text-muted',
                )}
              >
                <Icon className="size-[21px]" strokeWidth={active ? 2.4 : 1.9} />
                {label}
              </button>
            )
          })}
        </div>
      </nav>

      {moreSheet}

      {decks[0] && (
        <NoteEditor
          open={quickAdd}
          onClose={() => setQuickAdd(false)}
          deck={decks[0]}
          decks={decks}
          settings={settings}
        />
      )}
    </div>
  )
}
