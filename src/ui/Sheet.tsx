import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './primitives'

/**
 * Bottom-Sheet für alles Modale. Auf dem Handy von unten, auf breiten
 * Bildschirmen zentriert — eine Komponente, kein zweites Dialogsystem.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Fokus in das Sheet holen, damit Tastaturbedienung dort landet.
    const focusable = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Schließen"
        onClick={onClose}
        className="animate-fade absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'animate-card-in relative flex max-h-[92dvh] w-full flex-col',
          'rounded-t-xl border border-line bg-ink-2 sm:rounded-xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <IconButton label="Schließen" variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

        {footer && (
          <footer
            className="shrink-0 border-t border-line-soft px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/** Bestätigung für Löschungen. Einmal fragen, klar benennen, was passiert. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Löschen',
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: string
  confirmLabel?: string
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-md border border-line bg-surface-2 font-medium"
          >
            Abbrechen
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="h-12 flex-1 rounded-md border border-bad/40 bg-bad-dim font-medium text-bad"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </Sheet>
  )
}
