import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type Variant = 'accent' | 'surface' | 'ghost' | 'ok' | 'bad' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  accent: 'bg-accent text-ink hover:bg-accent-2 shadow-[0_6px_24px_-8px_rgba(139,124,255,0.7)]',
  surface: 'bg-surface-2 text-text border border-line hover:bg-surface-3',
  outline: 'bg-transparent text-text border border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2',
  ok: 'bg-ok text-ink hover:brightness-110',
  bad: 'bg-bad-dim text-bad border border-bad/30 hover:bg-bad/20',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-sm gap-1.5',
  md: 'h-12 px-4 text-[15px] rounded-md gap-2',
  lg: 'h-14 px-6 text-base rounded-lg gap-2.5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
  /** Haptisches Mikro-Feedback beim Tippen. */
  buzz?: boolean
}

export function Button({
  variant = 'surface',
  size = 'md',
  block,
  buzz = true,
  className,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        if (buzz) haptic('tap')
        onClick?.(e)
      }}
      className={cn(
        'inline-flex items-center justify-center font-medium',
        'transition-[transform,background-color,color,opacity] duration-150 ease-out-quint',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    />
  )
}

export function IconButton({
  label,
  className,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <Button
      {...rest}
      aria-label={label}
      title={label}
      className={cn('aspect-square px-0', className)}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Flächen
 * ------------------------------------------------------------------ */

export function Panel({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'li'
}) {
  return (
    <As className={cn('rounded-lg border border-line-soft bg-surface', className)}>{children}</As>
  )
}

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode
  tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'bad'
  className?: string
}) {
  const tones: Record<string, string> = {
    muted: 'bg-surface-2 text-muted border-line',
    accent: 'bg-accent-dim text-accent-2 border-accent/30',
    ok: 'bg-ok-dim text-ok border-ok/30',
    warn: 'bg-warn-dim text-warn border-warn/30',
    bad: 'bg-bad-dim text-bad border-bad/30',
  }
  return (
    <span
      className={cn(
        'num inline-flex items-center gap-1 rounded-xs border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">{children}</h2>
      {right}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Fortschrittsring — das visuelle Zentrum des Tagesziels
 * ------------------------------------------------------------------ */

export function Ring({
  value,
  size = 128,
  stroke = 10,
  children,
  tone = 'accent',
}: {
  /** 0..1 */
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
  tone?: 'accent' | 'ok'
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))
  const color = tone === 'ok' ? 'var(--color-ok)' : 'var(--color-accent)'

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 600ms var(--ease-out-quint)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

/** Schmaler Sessionfortschritt. Sichtbares Ende — das zieht durch. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div
        className="h-full rounded-full bg-accent"
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          transition: 'width 380ms var(--ease-out-quint)',
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Leere Zustände: immer mit nächstem Schritt, nie eine Sackgasse.
 * ------------------------------------------------------------------ */

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="animate-rise grid place-items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 text-faint">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'size-5 animate-spin rounded-full border-2 border-line border-t-accent',
        className,
      )}
      role="status"
      aria-label="Lädt"
    />
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'ok' | 'warn' | 'accent'
}) {
  const colors = { ok: 'text-ok', warn: 'text-warn', accent: 'text-accent-2' }
  return (
    <div className="min-w-0">
      <div className={cn('num text-2xl font-semibold tracking-tight', tone && colors[tone])}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted">{label}</div>
      {hint && <div className="truncate text-[11px] text-faint">{hint}</div>}
    </div>
  )
}
