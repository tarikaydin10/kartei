import { useLiveQuery } from 'dexie-react-hooks'
import { Flame } from 'lucide-react'
import { dueForecast, reviewsSince, totals } from '@/data/repo'
import type { AppSettings } from '@/data/types'
import { computeStreak, dayStats, goalDays, lastDays } from '@/domain/streak'
import { formatDay } from '@/lib/date'
import { cn } from '@/lib/cn'
import { Panel, SectionTitle, Stat } from '@/ui/primitives'

const WEEKS = 18
const WINDOW = 400 * 86_400_000

export function StatsScreen({ settings }: { settings: AppSettings }) {
  const history = useLiveQuery(() => reviewsSince(Date.now() - WINDOW), [], [])
  const forecast = useLiveQuery(() => dueForecast(14), [], [])
  const sums = useLiveQuery(() => totals(), [], {
    notes: 0,
    cards: 0,
    reviews: 0,
    mature: 0,
    young: 0,
    fresh: 0,
  })

  const stats = dayStats(history)
  const streak = computeStreak(goalDays(stats, settings.dailyGoal))
  const series = lastDays(stats, WEEKS * 7)

  const answered = history.length
  const correct = history.filter((r) => r.rating >= 3).length
  const accuracy = answered === 0 ? 0 : Math.round((correct / answered) * 100)
  const activeDays = [...stats.values()].filter((d) => d.reviews > 0).length
  const perActiveDay = activeDays === 0 ? 0 : Math.round(answered / activeDays)

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 pb-4">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Statistik</h1>

      <Panel className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Tage in Folge"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Flame className={cn('size-5', streak.current > 0 ? 'text-warn' : 'text-faint')} />
                {streak.current}
              </span>
            }
            hint={`Bestwert ${streak.best}`}
          />
          <Stat
            label="Trefferquote"
            value={`${accuracy}%`}
            tone={accuracy >= 80 ? 'ok' : accuracy >= 60 ? undefined : 'warn'}
            hint={`${answered} Antworten`}
          />
          <Stat label="pro Lerntag" value={perActiveDay} hint={`${activeDays} Lerntage`} />
        </div>
      </Panel>

      {/* Heatmap */}
      <div className="mt-6">
        <SectionTitle right={<span className="text-[11px] text-faint">{WEEKS} Wochen</span>}>
          Aktivität
        </SectionTitle>
        <Panel className="overflow-x-auto p-4">
          <div className="flex min-w-max gap-[3px]">
            {chunk(series, 7).map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.key}
                    title={`${formatDay(day.key)} · ${day.reviews} Antworten`}
                    className={cn(
                      'size-3 rounded-[3px]',
                      heatClass(day.reviews, settings.dailyGoal),
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-faint">
            <span>weniger</span>
            {[0, 1, 0.5, 1, 2].map((_, i) => (
              <div key={i} className={cn('size-3 rounded-[3px]', LEVELS[i])} />
            ))}
            <span>mehr</span>
          </div>
        </Panel>
      </div>

      {/* Fälligkeitsvorschau */}
      <div className="mt-6">
        <SectionTitle>Fällig in den nächsten 14 Tagen</SectionTitle>
        <Panel className="p-4">
          <Forecast values={forecast} />
        </Panel>
      </div>

      {/* Bestand */}
      <div className="mt-6">
        <SectionTitle>Sammlung</SectionTitle>
        <Panel className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Notizen" value={sums.notes} />
            <Stat label="Karten" value={sums.cards} />
            <Stat label="Antworten" value={sums.reviews} />
          </div>
          <div className="mt-4">
            <Composition mature={sums.mature} young={sums.young} fresh={sums.fresh} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

const LEVELS = [
  'bg-surface-2',
  'bg-accent/25',
  'bg-accent/45',
  'bg-accent/70',
  'bg-accent',
]

function heatClass(reviews: number, goal: number): string {
  if (reviews === 0) return LEVELS[0]!
  const ratio = reviews / Math.max(1, goal)
  if (ratio < 0.34) return LEVELS[1]!
  if (ratio < 0.67) return LEVELS[2]!
  if (ratio < 1) return LEVELS[3]!
  return LEVELS[4]!
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function Forecast({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  // Nur wenige Beschriftungen — bei 14 Balken auf Handybreite wird sonst
  // jede zweite unlesbar.
  const label = (i: number) => (i === 0 ? 'heute' : i === 7 ? '+7' : i === 13 ? '+13' : '')

  return (
    <div className="flex h-32 items-end gap-1">
      {values.map((v, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="num text-[10px] text-faint">{v > 0 ? v : ''}</span>
          <div
            className={cn('w-full rounded-t-[3px]', i === 0 ? 'bg-accent' : 'bg-accent/35')}
            style={{
              height: `${Math.max(v > 0 ? 4 : 1, (v / max) * 88)}px`,
              transition: 'height 400ms var(--ease-out-quint)',
            }}
          />
          <span className="h-3 truncate text-[10px] text-faint">{label(i)}</span>
        </div>
      ))}
    </div>
  )
}

function Composition({
  mature,
  young,
  fresh,
}: {
  mature: number
  young: number
  fresh: number
}) {
  const total = Math.max(1, mature + young + fresh)
  const parts = [
    { label: 'gefestigt', value: mature, cls: 'bg-ok', hint: 'Intervall ab 21 Tagen' },
    { label: 'im Aufbau', value: young, cls: 'bg-accent' },
    { label: 'neu', value: fresh, cls: 'bg-surface-3' },
  ]

  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        {parts.map((p) => (
          <div
            key={p.label}
            className={p.cls}
            style={{ width: `${(p.value / total) * 100}%`, transition: 'width 400ms var(--ease-out-quint)' }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cn('size-2 rounded-full', p.cls)} />
            {p.label} <span className="num text-faint">{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
