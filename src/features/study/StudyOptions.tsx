import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, FastForward, History, Play, Shuffle, Sparkles, Target } from 'lucide-react'
import { studyPools, type StudyRequest } from '@/data/repo'
import type { AppSettings, ID } from '@/data/types'
import { STUDY_MODES, type StudyMode } from '@/domain/session'
import { SegmentedControl } from '@/ui/Field'
import { SectionTitle } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'

/**
 * „Mehr lernen“: alles jenseits des Tagesplans an einem Ort.
 * Getrennt nach dem, was die Planung vorantreibt, und reiner Übung — damit
 * klar ist, welche Runde FSRS etwas angeht und welche nicht.
 */
export function StudyOptionsSheet({
  open,
  onClose,
  deckId,
  deckName,
  settings,
  onStart,
}: {
  open: boolean
  onClose: () => void
  deckId: ID | null
  deckName: string
  settings: AppSettings
  onStart: (request: StudyRequest) => void
}) {
  const pools = useLiveQuery(
    () => (open ? studyPools(deckId, settings) : undefined),
    [open, deckId, settings.newPerDay],
    undefined,
  )
  const [size, setSize] = useState(settings.sessionSize)

  useEffect(() => {
    if (open) setSize(settings.sessionSize)
  }, [open, settings.sessionSize])

  const start = (mode: StudyMode) => onStart({ deckId, mode, size })

  return (
    <Sheet open={open} onClose={onClose} title={`Mehr lernen · ${deckName}`}>
      <SegmentedControl
        label="Kartenzahl"
        value={size}
        onChange={setSize}
        options={[
          { value: 10, label: '10' },
          { value: 20, label: '20' },
          { value: 40, label: '40' },
        ]}
      />

      <div className="mt-5">
        <SectionTitle>Zählt für die Planung</SectionTitle>
        <div className="divide-y divide-line-soft overflow-hidden rounded-md border border-line-soft bg-surface">
          {(pools?.planned ?? 0) > 0 && (
            <ModeRow mode="due" icon={<Play className="size-4" />} count={pools?.planned} onPick={start} />
          )}
          <ModeRow mode="ahead" icon={<FastForward className="size-4" />} count={pools?.ahead} onPick={start} />
          <ModeRow mode="new" icon={<Sparkles className="size-4" />} count={pools?.fresh} onPick={start} />
        </div>
      </div>

      <div className="mt-5">
        <SectionTitle>Üben — ändert die Planung nicht</SectionTitle>
        <div className="divide-y divide-line-soft overflow-hidden rounded-md border border-line-soft bg-surface">
          <ModeRow mode="today" icon={<History className="size-4" />} count={pools?.today} onPick={start} />
          <ModeRow mode="hard" icon={<Target className="size-4" />} count={pools?.hard} onPick={start} />
          <ModeRow mode="random" icon={<Shuffle className="size-4" />} count={pools?.known} onPick={start} />
        </div>
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] leading-snug text-faint">
          <CalendarClock className="mt-px size-3.5 shrink-0" />
          Übungsantworten zählen fürs Tagesziel, lassen die Fälligkeiten aber, wie sie sind — Pauken
          am selben Tag würde die Intervalle sonst künstlich strecken.
        </p>
      </div>
    </Sheet>
  )
}

function ModeRow({
  mode,
  icon,
  count,
  onPick,
}: {
  mode: StudyMode
  icon: ReactNode
  count: number | undefined
  onPick: (mode: StudyMode) => void
}) {
  const info = STUDY_MODES[mode]
  return (
    <button
      onClick={() => onPick(mode)}
      disabled={!count}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{info.label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-faint">{info.description}</span>
      </span>
      <span className="num shrink-0 text-sm text-muted">
        {count === undefined ? '…' : count > 999 ? '999+' : count}
      </span>
    </button>
  )
}
