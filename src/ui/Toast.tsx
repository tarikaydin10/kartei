import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Info, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'ok' | 'bad' | 'info'

interface Toast {
  id: number
  message: string
  tone: Tone
  action?: { label: string; onClick: () => void }
}

interface ToastApi {
  show: (message: string, opts?: { tone?: Tone; action?: Toast['action']; ms?: number }) => void
}

const Ctx = createContext<ToastApi>({ show: () => {} })

export function useToast() {
  return useContext(Ctx)
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback<ToastApi['show']>((message, opts) => {
    const id = nextId++
    const toast: Toast = { id, message, tone: opts?.tone ?? 'info', action: opts?.action }
    setToasts((t) => [...t.slice(-2), toast])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.ms ?? 4200)
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(5.5rem + var(--safe-b))' }}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'animate-card-in pointer-events-auto flex w-full max-w-md items-center gap-3',
              'rounded-md border px-3.5 py-3 text-sm shadow-lg backdrop-blur',
              t.tone === 'ok' && 'border-ok/30 bg-ok-dim/90 text-ok',
              t.tone === 'bad' && 'border-bad/30 bg-bad-dim/90 text-bad',
              t.tone === 'info' && 'border-line bg-surface-2/95 text-text',
            )}
          >
            {t.tone === 'ok' && <Check className="size-4 shrink-0" />}
            {t.tone === 'bad' && <AlertTriangle className="size-4 shrink-0" />}
            {t.tone === 'info' && <Info className="size-4 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick()
                  setToasts((list) => list.filter((x) => x.id !== t.id))
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-xs px-2 py-1 font-medium underline decoration-dotted"
              >
                <Undo2 className="size-3.5" />
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
