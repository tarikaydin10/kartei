/** Alles tagesbasierte läuft über lokale Tagesschlüssel `YYYY-MM-DD`. */
export function dayKey(ts: number | Date = Date.now()): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function startOfDay(ts: number | Date = Date.now()): number {
  const d = ts instanceof Date ? new Date(ts) : new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts: number | Date = Date.now()): number {
  return startOfDay(ts) + 86_400_000 - 1
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Kalendertage zwischen zwei Tagesschlüsseln (lokal, DST-sicher). */
export function daysBetween(aKey: string, bKey: string): number {
  const a = Date.parse(`${aKey}T00:00:00`)
  const b = Date.parse(`${bKey}T00:00:00`)
  return Math.round((b - a) / 86_400_000)
}

const RTF = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })

/** „in 3 Tagen“, „morgen“, „jetzt fällig“. */
export function dueLabel(due: number, now = Date.now()): string {
  const diff = due - now
  if (diff <= 0) return 'jetzt fällig'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return RTF.format(mins, 'minute')
  const hours = Math.round(diff / 3_600_000)
  if (hours < 24 && dayKey(due) === dayKey(now)) return RTF.format(hours, 'hour')
  const days = daysBetween(dayKey(now), dayKey(due))
  if (days < 31) return RTF.format(days, 'day')
  if (days < 365) return RTF.format(Math.round(days / 30), 'month')
  return RTF.format(Math.round(days / 365), 'year')
}

export function intervalLabel(ms: number): string {
  const mins = ms / 60_000
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min`
  const hours = mins / 60
  if (hours < 24) return `${Math.round(hours)} h`
  const days = hours / 24
  if (days < 31) return `${Math.round(days)} d`
  const months = days / 30.44
  if (months < 18) return `${Math.round(months)} mon`
  return `${(days / 365).toFixed(1)} a`
}

export function formatDay(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
}

/** „gerade eben“, „vor 5 Minuten“, „gestern“ — für Zeitpunkte in der Vergangenheit. */
export function agoLabel(ts: number, now = Date.now()): string {
  const mins = Math.round((now - ts) / 60_000)
  if (mins < 1) return 'gerade eben'
  if (mins < 60) return RTF.format(-mins, 'minute')
  const days = daysBetween(dayKey(ts), dayKey(now))
  if (days === 0) return RTF.format(-Math.round(mins / 60), 'hour')
  return RTF.format(-days, 'day')
}
