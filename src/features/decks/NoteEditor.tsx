import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertCircle, Keyboard } from 'lucide-react'
import { db } from '@/data/db'
import { createNote, deleteNote, updateNote, cardsOfNote } from '@/data/repo'
import type { AppSettings, Deck, ID, NoteTypeId } from '@/data/types'
import { emptyFields, missingRequired, noteType } from '@/domain/notetypes'
import { normalize } from '@/domain/answer'
import { Button } from '@/ui/primitives'
import { Input, Label, Textarea } from '@/ui/Field'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { cn } from '@/lib/cn'
import { CyrillicKeyboard } from '@/features/study/CyrillicKeyboard'

type El = HTMLInputElement | HTMLTextAreaElement

export function NoteEditor({
  open,
  onClose,
  deck,
  decks,
  noteId,
  settings,
}: {
  open: boolean
  onClose: () => void
  deck: Deck
  decks: Deck[]
  /** Gesetzt = bearbeiten, leer = neu anlegen. */
  noteId?: ID | null
  settings: AppSettings
}) {
  const toast = useToast()
  const noteTypeId: NoteTypeId = deck.noteTypeId
  const type = noteType(noteTypeId)

  const existing = useLiveQuery(
    async () => (noteId ? await db.notes.get(noteId) : undefined),
    [noteId],
    undefined,
  )
  const existingCards = useLiveQuery(
    async () => (noteId ? await cardsOfNote(noteId) : []),
    [noteId],
    [],
  )

  const [fields, setFields] = useState<Record<string, string>>(() => emptyFields(noteTypeId))
  const [tags, setTags] = useState('')
  const [templates, setTemplates] = useState<string[]>(() =>
    type.templates.filter((t) => t.byDefault).map((t) => t.id),
  )
  const [deckId, setDeckId] = useState<ID>(deck.id)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [showKeyboard, setShowKeyboard] = useState(false)
  const refs = useRef(new Map<string, El>())

  /* Formular an die geöffnete Notiz anpassen. */
  useEffect(() => {
    if (!open) return
    if (noteId && existing) {
      setFields({ ...emptyFields(existing.noteTypeId), ...existing.fields })
      setTags(existing.tags.join(' '))
      setDeckId(existing.deckId)
    } else if (!noteId) {
      setFields(emptyFields(noteTypeId))
      setTags('')
      setDeckId(deck.id)
      setTemplates(type.templates.filter((t) => t.byDefault).map((t) => t.id))
    }
  }, [open, noteId, existing, noteTypeId, deck.id, type.templates])

  useEffect(() => {
    if (noteId && existingCards.length > 0) {
      setTemplates(existingCards.map((c) => c.templateId))
    }
  }, [noteId, existingCards])

  /* Dublette schon beim Tippen melden — billiger als später aufräumen. */
  const identityValue = fields[type.identityField] ?? ''
  const duplicate = useLiveQuery(async () => {
    const value = normalize(identityValue)
    if (!value) return null
    const rows = await db.notes.where('deckId').equals(deckId).toArray()
    return (
      rows.find(
        (n) =>
          !n.deletedAt &&
          n.id !== noteId &&
          normalize(n.fields[type.identityField] ?? '') === value,
      ) ?? null
    )
  }, [identityValue, deckId, noteId])

  const missing = useMemo(() => missingRequired(noteTypeId, fields), [noteTypeId, fields])
  const canSave = missing.length === 0 && templates.length > 0

  const setField = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }))

  const insert = (ch: string) => {
    if (!activeKey) return
    const el = refs.current.get(activeKey)
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    setField(activeKey, el.value.slice(0, start) + ch + el.value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + ch.length, start + ch.length)
    })
  }

  const backspace = () => {
    if (!activeKey) return
    const el = refs.current.get(activeKey)
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    if (start === end && start === 0) return
    const from = start === end ? start - 1 : start
    setField(activeKey, el.value.slice(0, from) + el.value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(from, from)
    })
  }

  const save = async (andNext: boolean) => {
    if (!canSave) return
    const tagList = tags.split(/[\s,]+/).filter(Boolean)
    if (noteId) {
      await updateNote(noteId, { fields, tags: tagList, deckId, templateIds: templates })
      toast.show('Gespeichert', { tone: 'ok' })
      onClose()
      return
    }
    await createNote({ deckId, noteTypeId, fields, tags: tagList, templateIds: templates })
    toast.show(`Angelegt · ${templates.length} ${templates.length === 1 ? 'Karte' : 'Karten'}`, {
      tone: 'ok',
    })
    if (andNext) {
      setFields(emptyFields(noteTypeId))
      refs.current.get(type.fields[0]!.key)?.focus()
    } else {
      onClose()
    }
  }

  const remove = async () => {
    if (!noteId) return
    await deleteNote(noteId)
    toast.show('Gelöscht', { tone: 'ok' })
    onClose()
  }

  const activeIsRussian =
    activeKey !== null && type.fields.find((f) => f.key === activeKey)?.lang === 'ru'
  const keyboardVisible = showKeyboard && activeIsRussian

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={noteId ? 'Karte bearbeiten' : 'Neue Karte'}
      footer={
        <div className="space-y-2">
          {keyboardVisible && (
            <div className="pb-1">
              <div className="mb-1 flex justify-end">
                <button
                  onClick={() => insert('́')}
                  className="rounded-xs border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted"
                  title="Betonungszeichen auf den letzten Buchstaben"
                >
                  Betonung ́
                </button>
              </div>
              <CyrillicKeyboard
                onInsert={insert}
                onBackspace={backspace}
                onSubmit={() => void save(!noteId)}
                submitLabel="Speichern"
              />
            </div>
          )}
          <div className="flex gap-2">
            {noteId ? (
              <>
                <Button variant="bad" onClick={remove}>
                  Löschen
                </Button>
                <Button variant="accent" block disabled={!canSave} onClick={() => void save(false)}>
                  Speichern
                </Button>
              </>
            ) : (
              <>
                <Button variant="surface" disabled={!canSave} onClick={() => void save(false)}>
                  Speichern
                </Button>
                <Button variant="accent" block disabled={!canSave} onClick={() => void save(true)}>
                  Speichern &amp; nächste
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {type.fields.map((f) => {
          const shared = {
            value: fields[f.key] ?? '',
            placeholder: f.placeholder,
            lang: f.lang,
            spellCheck: false,
            autoCapitalize: 'off' as const,
            autoCorrect: 'off' as const,
            className: cn(f.lang === 'ru' && 'font-ru'),
            onFocus: () => {
              setActiveKey(f.key)
              if (f.lang === 'ru' && settings.cyrillicKeyboard) setShowKeyboard(true)
              else setShowKeyboard(false)
            },
            onChange: (e: React.ChangeEvent<El>) => setField(f.key, e.target.value),
            ref: (el: El | null) => {
              if (el) refs.current.set(f.key, el)
              else refs.current.delete(f.key)
            },
            inputMode:
              f.lang === 'ru' && settings.cyrillicKeyboard ? ('none' as const) : ('text' as const),
          }

          return (
            <div key={f.key}>
              {f.multiline ? (
                <Textarea
                  {...shared}
                  label={`${f.label}${f.required ? ' *' : ''}`}
                  hint={f.hint}
                  rows={2}
                />
              ) : (
                <Input {...shared} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} />
              )}
              {f.key === type.identityField && duplicate && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warn">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Gibt es in diesem Deck schon:{' '}
                  <span className="font-ru font-medium">
                    {duplicate.fields[type.secondaryField]}
                  </span>
                </p>
              )}
            </div>
          )
        })}

        <Input
          label="Tags"
          hint="Mit Leerzeichen trennen. Zum Filtern später."
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onFocus={() => {
            setActiveKey(null)
            setShowKeyboard(false)
          }}
          placeholder="essen alltag"
        />

        <div>
          <Label hint="Jede Richtung ist eine eigene Karte mit eigenem Fortschritt.">
            Richtungen
          </Label>
          <div className="space-y-1.5">
            {type.templates.map((t) => {
              const on = templates.includes(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() =>
                    setTemplates((list) =>
                      on ? list.filter((x) => x !== t.id) : [...list, t.id],
                    )
                  }
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
                    on ? 'border-accent/40 bg-accent-dim' : 'border-line bg-surface',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-[5px] border',
                      on ? 'border-accent bg-accent text-ink' : 'border-line',
                    )}
                  >
                    {on && '✓'}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px]">{t.label}</span>
                  <span className="shrink-0 text-xs text-faint">{t.short}</span>
                </button>
              )
            })}
          </div>
          {templates.length === 0 && (
            <p className="mt-1.5 text-xs text-bad">Mindestens eine Richtung wählen.</p>
          )}
        </div>

        {decks.length > 1 && (
          <div>
            <Label>Deck</Label>
            <select
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3.5 py-3 outline-none"
            >
              {decks
                .filter((d) => d.noteTypeId === noteTypeId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.emoji} {d.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {activeIsRussian && settings.cyrillicKeyboard && (
          <button
            onClick={() => setShowKeyboard((v) => !v)}
            className="flex items-center gap-2 text-xs text-faint hover:text-muted"
          >
            <Keyboard className="size-3.5" />
            {showKeyboard ? 'Bildschirmtastatur ausblenden' : 'Bildschirmtastatur einblenden'}
          </button>
        )}
      </div>
    </Sheet>
  )
}
