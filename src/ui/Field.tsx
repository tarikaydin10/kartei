import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

const BASE =
  'w-full rounded-md border border-line bg-surface px-3.5 py-3 text-text placeholder:text-faint ' +
  'transition-colors duration-150 focus:border-accent/60 focus:bg-surface-2 outline-none'

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <span className="text-[13px] font-medium text-muted">{children}</span>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
  )
}

export function Input({
  label,
  hint,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <Label hint={hint}>{label}</Label>}
      <input {...rest} className={cn(BASE, className)} />
    </label>
  )
}

export function Textarea({
  label,
  hint,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <Label hint={hint}>{label}</Label>}
      <textarea {...rest} rows={rest.rows ?? 2} className={cn(BASE, 'resize-y', className)} />
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('tap')
        onChange(!checked)
      }}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-faint">{hint}</span>}
      </span>
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className="absolute top-1 size-5 rounded-full bg-white shadow"
          style={{
            left: checked ? 'calc(100% - 1.5rem)' : '0.25rem',
            transition: 'left 200ms var(--ease-out-quint)',
          }}
        />
      </span>
    </button>
  )
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 5,
  label,
  hint,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  hint?: string
  suffix?: string
}) {
  const set = (v: number) => {
    haptic('tap')
    onChange(Math.max(min, Math.min(max, v)))
  }
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-faint">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-2 p-1">
        <button
          onClick={() => set(value - step)}
          aria-label={`${label} verringern`}
          className="grid size-8 place-items-center rounded-xs text-muted hover:bg-surface-3 hover:text-text"
        >
          −
        </button>
        <span className="num w-12 text-center text-[15px] font-medium">
          {value}
          {suffix}
        </span>
        <button
          onClick={() => set(value + step)}
          aria-label={`${label} erhöhen`}
          className="grid size-8 place-items-center rounded-xs text-muted hover:bg-surface-3 hover:text-text"
        >
          +
        </button>
      </span>
    </div>
  )
}

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
  label?: string
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-md border border-line bg-surface p-1"
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            onClick={() => {
              haptic('tap')
              onChange(o.value)
            }}
            className={cn(
              'h-10 flex-1 rounded-xs text-sm font-medium transition-colors duration-150',
              o.value === value ? 'bg-accent text-ink' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Row({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3.5 text-left',
        onClick && 'transition-colors duration-150 hover:bg-surface-2 active:bg-surface-2',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
