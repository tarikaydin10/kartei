import { useMemo } from 'react'
import { Volume2 } from 'lucide-react'
import { PRONUNCIATION_LEGEND, annotate, pronounce } from '@/domain/pronounce'
import { withoutStress } from '@/domain/answer'
import { speak, useLocalVoice } from '@/lib/speech'
import { cn } from '@/lib/cn'

/**
 * Lautschrift zu einem russischen Text, dazu ein Vorlese-Knopf, falls das
 * Gerät eine lokale russische Stimme hat. Rendert nichts, wenn beides fehlt —
 * etwa weil die Betonung eines mehrsilbigen Worts nicht markiert ist.
 */
export function Pronunciation({
  text,
  size = 'md',
  className,
}: {
  text: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const transcript = useMemo(() => pronounce(text), [text])
  const voice = useLocalVoice('ru')
  if (!text.trim() || (!transcript && !voice)) return null

  return (
    <p
      className={cn(
        'flex items-center justify-center gap-1 text-faint',
        size === 'sm' ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      {transcript && (
        <span title={PRONUNCIATION_LEGEND} className="break-words">
          [{transcript}]
        </span>
      )}
      {voice && (
        <button
          type="button"
          onClick={() => speak(withoutStress(text).replace(/\|/g, ', '), voice)}
          aria-label="Vorlesen"
          title="Vorlesen"
          className={cn(
            'grid shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text',
            size === 'sm' ? 'size-6' : 'size-7',
          )}
        >
          <Volume2 className={size === 'sm' ? 'size-3.5' : 'size-4'} />
        </button>
      )}
    </p>
  )
}

/**
 * Mischtext wie „m., Pl. лю́ди“ mit der Lautschrift direkt hinter jeder
 * russischen Stelle: „m., Pl. лю́ди [ljúdi]“. Ohne Aussprache einfach der Text.
 */
export function InlinePronunciation({ text, enabled = true }: { text: string; enabled?: boolean }) {
  const parts = useMemo(() => (enabled ? annotate(text) : []), [text, enabled])
  if (!enabled) return <>{text}</>
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p.text}
          {p.pron && (
            <span title={PRONUNCIATION_LEGEND} className="font-sans text-faint">
              {' '}
              [{p.pron}]
            </span>
          )}
        </span>
      ))}
    </>
  )
}
