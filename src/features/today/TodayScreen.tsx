import { useLiveQuery } from 'dexie-react-hooks'
import { Flame, Plus, Play, ShieldCheck, Sparkles } from 'lucide-react'
import { countsByDeck, countsFor, listDecks, reviewsSince, reviewsToday } from '@/data/repo'
import type { AppSettings, ID } from '@/data/types'
import { computeStreak, dayStats, goalDays } from '@/domain/streak'
import { cn } from '@/lib/cn'
import { Badge, Button, Empty, Panel, Ring, SectionTitle } from '@/ui/primitives'

const YEAR = 400 * 86_400_000

export function TodayScreen({
  settings,
  onStudy,
  onAddCard,
  onOpenDeck,
  onOpenData,
}: {
  settings: AppSettings
  onStudy: (deckId: ID | null) => void
  onAddCard: () => void
  onOpenDeck: (deckId: ID) => void
  onOpenData: () => void
}) {
  const decks = useLiveQuery(() => listDecks(), [], [])
  const perDeck = useLiveQuery(() => countsByDeck(), [], new Map())
  const all = useLiveQuery(() => countsFor(null), [], { due: 0, fresh: 0, learning: 0, total: 0 })
  const today = useLiveQuery(() => reviewsToday(), [], [])
  const history = useLiveQuery(() => reviewsSince(Date.now() - YEAR), [], [])

  const streak = computeStreak(goalDays(dayStats(history), settings.dailyGoal))
  const doneToday = today.length
  const goal = Math.max(1, settings.dailyGoal)
  const progress = Math.min(1, doneToday / goal)
  const workload = all.due + Math.min(all.fresh, settings.newPerDay)
  const hasCards = all.total > 0

  const needsBackup =
    all.total >= 40 &&
    (settings.lastBackupAt === null || Date.now() - settings.lastBackupAt > 21 * 86_400_000)

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4">
      {/* Tagesziel */}
      <Panel className="overflow-hidden">
        <div className="flex items-center gap-5 p-5">
          <Ring value={progress} size={116} tone={progress >= 1 ? 'ok' : 'accent'}>
            <div>
              <div className="num text-2xl font-semibold tracking-tight">{doneToday}</div>
              <div className="text-[10px] tracking-wide text-faint uppercase">von {goal}</div>
            </div>
          </Ring>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Flame
                className={cn('size-5', streak.current > 0 ? 'text-warn' : 'text-faint')}
                strokeWidth={2.2}
              />
              <span className="num text-xl font-semibold">{streak.current}</span>
              <span className="text-sm text-muted">
                {streak.current === 1 ? 'Tag' : 'Tage'} in Folge
              </span>
            </div>

            <p className="mt-2 text-sm leading-snug text-muted">{headline(progress, workload, streak.current)}</p>

            {streak.forgivenUsed > 0 && streak.current > 0 && (
              <p className="mt-1.5 text-[11px] text-warn">
                Ein Tag wurde überbrückt — heute wieder dran, dann steht er.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-line-soft p-4">
          {hasCards ? (
            <Button variant="accent" size="lg" block onClick={() => onStudy(null)}>
              <Play className="size-4" />
              {workload > 0 ? `Lernen · ${Math.min(workload, settings.sessionSize)} Karten` : 'Vorarbeiten'}
            </Button>
          ) : (
            <Button variant="accent" size="lg" block onClick={onAddCard}>
              <Plus className="size-4" />
              Erste Karte anlegen
            </Button>
          )}

          <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-faint">
            <span className="num">
              <span className="font-medium text-muted">{fmt(all.due)}</span> fällig
            </span>
            <span>·</span>
            <span className="num">
              <span className="font-medium text-muted">{fmt(all.fresh)}</span> neu
            </span>
            <span>·</span>
            <span className="num">
              <span className="font-medium text-muted">{fmt(all.total)}</span> gesamt
            </span>
          </div>
        </div>
      </Panel>

      {needsBackup && (
        <button
          onClick={onOpenData}
          className="mt-3 flex w-full items-center gap-3 rounded-md border border-warn/25 bg-warn-dim/60 px-4 py-3 text-left"
        >
          <ShieldCheck className="size-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-warn">
            Länger kein Backup. Die Daten liegen nur auf diesem Gerät — ein Export dauert zwei
            Sekunden.
          </span>
        </button>
      )}

      {/* Decks */}
      {decks.length > 0 && (
        <div className="mt-6">
          <SectionTitle>Decks</SectionTitle>
          <Panel className="divide-y divide-line-soft overflow-hidden">
            {decks.map((deck) => {
              const c = perDeck.get(deck.id) ?? { due: 0, fresh: 0, learning: 0, total: 0 }
              const ready = c.due + Math.min(c.fresh, settings.newPerDay)
              return (
                <div key={deck.id} className="flex items-center">
                  <button
                    onClick={() => onOpenDeck(deck.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="text-lg leading-none">{deck.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{deck.name}</span>
                      <span className="num block text-xs text-faint">{c.total} Karten</span>
                    </span>
                    {c.due > 0 && <Badge tone="accent">{fmt(c.due)}</Badge>}
                    {c.due === 0 && c.fresh > 0 && <Badge tone="muted">{fmt(c.fresh)} neu</Badge>}
                  </button>
                  <button
                    onClick={() => onStudy(deck.id)}
                    disabled={ready === 0}
                    aria-label={`${deck.name} lernen`}
                    className="mr-2 grid size-10 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-accent-2 disabled:opacity-25"
                  >
                    <Play className="size-4" />
                  </button>
                </div>
              )
            })}
          </Panel>
        </div>
      )}

      {!hasCards && decks.length > 0 && (
        <Empty
          icon={<Sparkles className="size-8" />}
          title="Noch keine Karten"
          body="Leg eine Vokabel an oder importiere eine Liste — CSV aus einer Tabelle funktioniert direkt."
          action={
            <div className="flex gap-2">
              <Button variant="accent" onClick={onAddCard}>
                <Plus className="size-4" /> Karte anlegen
              </Button>
              <Button variant="surface" onClick={onOpenData}>
                Importieren
              </Button>
            </div>
          }
        />
      )}
    </div>
  )
}

function headline(progress: number, workload: number, streak: number): string {
  if (progress >= 1) return 'Tagesziel erreicht. Alles weitere ist Bonus.'
  if (workload === 0) return 'Nichts fällig. Du kannst vorarbeiten oder es dabei lassen.'
  if (streak === 0) return 'Eine Runde jetzt, und der Streak beginnt.'
  if (progress > 0) return 'Angefangen. Der Rest ist kurz.'
  return 'Kurz dranbleiben hält den Streak.'
}

/** Nie eine hoffnungslose Zahl anzeigen — das lähmt mehr als es antreibt. */
function fmt(n: number): string {
  return n > 999 ? '999+' : String(n)
}
