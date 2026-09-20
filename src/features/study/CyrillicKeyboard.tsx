import { Delete, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

/**
 * ЙЦУКЕН als Bildschirmtastatur.
 *
 * Warum eingebaut statt Systemtastatur: sie funktioniert auf Desktop und
 * Handy identisch, verlangt kein Umstellen der Tastatursprache mitten in der
 * Session und trainiert dasselbe Layout wie eine echte russische Tastatur.
 * Transliteration („privet“) gibt es bewusst nicht — sie ist mehrdeutig und
 * würde die falsche Verknüpfung einüben.
 */
const ROWS = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
  ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
  ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ё'],
]

export function CyrillicKeyboard({
  onInsert,
  onBackspace,
  onSubmit,
  submitLabel = 'Prüfen',
  lettersDisabled,
}: {
  onInsert: (ch: string) => void
  onBackspace: () => void
  onSubmit: () => void
  submitLabel?: string
  /** Nach dem Prüfen sind die Buchstaben inaktiv, Enter bleibt bedienbar. */
  lettersDisabled?: boolean
}) {
  const key = (ch: string) => (
    <Key key={ch} onPress={() => onInsert(ch)} disabled={lettersDisabled}>
      {ch}
    </Key>
  )

  return (
    <div
      className="select-none rounded-lg border border-line-soft bg-ink-2 p-1.5"
      // Ein mousedown auf der Tastatur darf dem Eingabefeld nie den Fokus nehmen.
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1">{ROWS[0]!.map(key)}</div>
      <div className="mt-1 flex gap-1 px-[3%]">{ROWS[1]!.map(key)}</div>
      <div className="mt-1 flex gap-1">
        {ROWS[2]!.map(key)}
        <Key onPress={onBackspace} disabled={lettersDisabled} wide aria-label="Zeichen löschen">
          <Delete className="size-4" />
        </Key>
      </div>
      <div className="mt-1 flex gap-1">
        <Key onPress={() => onInsert('-')} disabled={lettersDisabled}>
          -
        </Key>
        <Key onPress={() => onInsert(' ')} disabled={lettersDisabled} grow aria-label="Leerzeichen">
          <span className="text-xs tracking-widest text-faint">␣</span>
        </Key>
        <Key onPress={onSubmit} accent wide aria-label={submitLabel}>
          <CornerDownLeft className="size-4" />
        </Key>
      </div>
    </div>
  )
}

function Key({
  children,
  onPress,
  disabled,
  wide,
  grow,
  accent,
  ...rest
}: {
  children: React.ReactNode
  onPress: () => void
  disabled?: boolean
  wide?: boolean
  grow?: boolean
  accent?: boolean
  'aria-label'?: string
}) {
  return (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic('tap')
        onPress()
      }}
      className={cn(
        'grid h-11 min-w-0 place-items-center rounded-xs border text-[17px] leading-none',
        'transition-[transform,background-color] duration-100 active:scale-95 disabled:opacity-40',
        accent
          ? 'border-accent/40 bg-accent-dim text-accent-2'
          : 'border-line-soft bg-surface-2 text-text active:bg-surface-3',
        grow ? 'flex-[3]' : wide ? 'flex-[1.6]' : 'flex-1',
      )}
    >
      {children}
    </button>
  )
}
