import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Dumbbell, Eye, Lightbulb, RotateCcw, Target, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { sound } from '@/lib/sound'
import { dueLabel } from '@/lib/date'
import { checkAnswer, displayForms, type AnswerCheck, type DiffSegment } from '@/domain/answer'
import { deriveRating } from '@/domain/srs'
import { STUDY_MODES, isPractice, requeue, type SessionTally } from '@/domain/session'
import { fieldOf, noteType, templateOf } from '@/domain/notetypes'
import {
  buildSession,
  recordReview,
  undoLastReview,
  type StudyCard,
  type StudyRequest,
} from '@/data/repo'
import type { AppSettings, Card, ID } from '@/data/types'
import { Button, ProgressBar, Spinner } from '@/ui/primitives'
import { CyrillicKeyboard } from './CyrillicKeyboard'
import { InlinePronunciation, Pronunciation } from './Pronunciation'

type Phase = 'loading' | 'prompt' | 'result' | 'retype' | 'done'

const AUTO_ADVANCE_MS = 850

/** Was nach einer Antwort gilt — damit „Antwort zurücknehmen“ alles zurückdreht. */
interface AnswerSnapshot {
  queue: StudyCard[]
  tally: SessionTally
  done: Set<ID>
  missed: Set<ID>
}

export function StudyScreen({
  request,
  deckName,
  settings,
  onExit,
  onRestart,
  onMore,
}: {
  request: StudyRequest
  deckName: string
  settings: AppSettings
  onExit: () => void
  /** Neue Session starten, z. B. dieselben Karten als Übung. */
  onRestart: (request: StudyRequest) => void
  /** Auswahl „Mehr lernen“ öffnen. */
  onMore: () => void
}) {
  const practice = isPractice(request.mode)
  const [queue, setQueue] = useState<StudyCard[]>([])
  const [total, setTotal] = useState(0)
  const [pos, setPos] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [typed, setTyped] = useState('')
  const [check, setCheck] = useState<AnswerCheck | null>(null)
  const [nextDue, setNextDue] = useState<number | null>(null)
  const [hintUsed, setHintUsed] = useState(false)
  const [held, setHeld] = useState(false)
  const [done, setDone] = useState<Set<ID>>(new Set())
  /** Karten mit mindestens einer falschen oder knappen Antwort in dieser Session. */
  const [missed, setMissed] = useState<Set<ID>>(new Set())
  const [tally, setTally] = useState<SessionTally>({
    done: 0,
    total: 0,
    correct: 0,
    near: 0,
    wrong: 0,
    learnedNew: 0,
    durationMs: 0,
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)
  const shownAt = useRef(Date.now())
  const advanceTimer = useRef<number | null>(null)
  const sessionStart = useRef(Date.now())
  const lastAnswer = useRef<AnswerSnapshot | null>(null)
  const pendingReview = useRef<Promise<Card> | null>(null)

  const current = queue[pos]
  const type = current ? noteType(current.note.noteTypeId) : null
  const template = current ? templateOf(current.note.noteTypeId, current.card.templateId) : undefined
  const promptText = current && template ? (current.note.fields[template.promptField] ?? '') : ''
  const answerRaw = current && template ? (current.note.fields[template.answerField] ?? '') : ''
  const cyrillic = template?.inputLang === 'ru' && settings.cyrillicKeyboard
  const showPron = settings.showPronunciation && current !== undefined
  const promptPron =
    showPron && template && fieldOf(current.note.noteTypeId, template.promptField)?.pronounce === true
  const answerPron =
    showPron && template && fieldOf(current.note.noteTypeId, template.answerField)?.pronounce === true

  /* --- Laden ------------------------------------------------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      const cards = await buildSession(request.deckId, settings, {
        mode: request.mode,
        size: request.size,
        cardIds: request.cardIds,
      })
      if (!alive) return
      setQueue(cards)
      setTotal(cards.length)
      setTally((t) => ({ ...t, total: cards.length }))
      setPhase(cards.length === 0 ? 'done' : 'prompt')
      shownAt.current = Date.now()
      sessionStart.current = Date.now()
    })()
    return () => {
      alive = false
    }
    // Absichtlich nur beim Einstieg: eine Session wird nicht mitten im Lauf neu gebaut.
    // Eine neue Session ist ein neues Component (key in App.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* --- Fokus und Caret -------------------------------------------- */
  useEffect(() => {
    if (phase === 'prompt' || phase === 'retype') {
      const el = inputRef.current
      el?.focus()
      shownAt.current = Date.now()
    }
  }, [phase, pos])

  useEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      const c = caretRef.current
      inputRef.current.setSelectionRange(c, c)
      caretRef.current = null
    }
  }, [typed])

  const clearAdvance = useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
  }, [])

  useEffect(() => clearAdvance, [clearAdvance])

  /* --- Ablauf ------------------------------------------------------ */

  const goNext = useCallback(() => {
    clearAdvance()
    setCheck(null)
    setNextDue(null)
    setTyped('')
    setHintUsed(false)
    setHeld(false)
    setPos((p) => {
      const next = p + 1
      if (next >= queue.length) {
        setPhase('done')
        sound.done()
        haptic('done')
        return p
      }
      setPhase('prompt')
      return next
    })
  }, [clearAdvance, queue.length])

  const grade = useCallback(
    async (verdict: 'correct' | 'near' | 'wrong', typedValue: string) => {
      if (!current) return
      const duration = Date.now() - shownAt.current
      let rating = deriveRating(verdict, duration, answerRaw.length, current.card.state)
      // Mit Hinweis gelöst ist bestenfalls „Schwer“ — sonst belügt sich der Algorithmus.
      if (hintUsed && rating > 2) rating = 2

      lastAnswer.current = { queue, tally, done, missed }
      const pending = recordReview({
        card: current.card,
        rating,
        verdict,
        typed: typedValue,
        durationMs: duration,
        deviceId: settings.deviceId,
        practice,
      })
      pendingReview.current = pending
      const updated = await pending
      setNextDue(practice ? null : updated.due)

      const firstTime = !done.has(current.card.id)
      if (firstTime) setDone((s) => new Set(s).add(current.card.id))
      if (verdict !== 'correct') setMissed((s) => new Set(s).add(current.card.id))
      setTally((t) => ({
        ...t,
        done: firstTime ? t.done + 1 : t.done,
        correct: verdict === 'correct' ? t.correct + 1 : t.correct,
        near: verdict === 'near' ? t.near + 1 : t.near,
        wrong: verdict === 'wrong' ? t.wrong + 1 : t.wrong,
        learnedNew:
          !practice && current.card.state === 0 && firstTime ? t.learnedNew + 1 : t.learnedNew,
        durationMs: Date.now() - sessionStart.current,
      }))

      // „Nochmal“ bringt die Karte innerhalb der Session zurück.
      if (rating === 1) {
        setQueue((q) => requeue(q, pos, 3).map((c, i) => (i === pos ? { ...c, card: updated } : c)))
      } else {
        setQueue((q) => q.map((c, i) => (i === pos ? { ...c, card: updated } : c)))
      }

      if (verdict === 'correct') {
        sound.correct()
        haptic('ok')
        advanceTimer.current = window.setTimeout(goNext, AUTO_ADVANCE_MS)
      } else if (verdict === 'near') {
        sound.near()
        haptic('near')
      } else {
        sound.wrong()
        haptic('bad')
      }
    },
    [answerRaw.length, current, done, goNext, hintUsed, missed, pos, practice, queue, settings.deviceId, tally],
  )

  const submit = useCallback(() => {
    if (!current || phase !== 'prompt') return
    const result = checkAnswer(typed, answerRaw, {
      ignoreYo: settings.ignoreYo,
      ignoreCase: settings.ignoreCase,
    })
    setCheck(result)
    setPhase('result')
    void grade(result.verdict, typed)
  }, [answerRaw, current, grade, phase, settings.ignoreCase, settings.ignoreYo, typed])

  const giveUp = useCallback(() => {
    if (!current || phase !== 'prompt') return
    const result = checkAnswer('', answerRaw, {
      ignoreYo: settings.ignoreYo,
      ignoreCase: settings.ignoreCase,
    })
    setCheck({ ...result, diff: [{ type: 'missing', text: result.best }] })
    setPhase('result')
    void grade('wrong', typed)
  }, [answerRaw, current, grade, phase, settings.ignoreCase, settings.ignoreYo, typed])

  const continueFromResult = useCallback(() => {
    clearAdvance()
    if (check?.verdict === 'wrong' && settings.retypeOnWrong) {
      setTyped('')
      setPhase('retype')
      return
    }
    goNext()
  }, [check?.verdict, clearAdvance, goNext, settings.retypeOnWrong])

  /**
   * Antwort zurücknehmen: Review löschen und die Session auf den Stand davor
   * setzen — inklusive des Kartenzustands in der Schlange. Sonst würde die
   * nächste Antwort auf dem schon fortgeschriebenen Zustand aufsetzen, und der
   * Cache wiche vom Replay des Logs ab.
   */
  const undo = useCallback(async () => {
    if (!current) return
    clearAdvance()
    // Erst warten, bis die Antwort sicher geschrieben ist — sonst träfe das
    // Löschen die vorherige.
    await pendingReview.current
    const restored = await undoLastReview(current.card.id)
    const snap = lastAnswer.current
    if (snap) {
      setQueue(snap.queue.map((c, i) => (i === pos && restored ? { ...c, card: restored } : c)))
      setTally(snap.tally)
      setDone(snap.done)
      setMissed(snap.missed)
      lastAnswer.current = null
    }
    setCheck(null)
    setNextDue(null)
    setTyped('')
    setPhase('prompt')
  }, [clearAdvance, current, pos])

  /* --- Tastatur (Desktop) ----------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'prompt') submit()
        else if (phase === 'result') continueFromResult()
        else if (phase === 'retype') retypeSubmit()
      } else if (e.key === 'Escape') {
        if (phase === 'retype') goNext()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, submit, continueFromResult, typed])

  const retypeSubmit = () => {
    const ok = checkAnswer(typed, answerRaw, {
      ignoreYo: settings.ignoreYo,
      ignoreCase: settings.ignoreCase,
    })
    if (ok.verdict === 'correct') {
      haptic('ok')
      goNext()
    } else {
      haptic('bad')
      setTyped('')
      inputRef.current?.focus()
    }
  }

  const insert = (ch: string) => {
    const el = inputRef.current
    if (!el) {
      setTyped((t) => t + ch)
      return
    }
    const start = el.selectionStart ?? typed.length
    const end = el.selectionEnd ?? start
    setTyped(typed.slice(0, start) + ch + typed.slice(end))
    caretRef.current = start + ch.length
  }

  const backspace = () => {
    const el = inputRef.current
    if (!el) {
      setTyped((t) => t.slice(0, -1))
      return
    }
    const start = el.selectionStart ?? typed.length
    const end = el.selectionEnd ?? start
    if (start === end) {
      if (start === 0) return
      setTyped(typed.slice(0, start - 1) + typed.slice(end))
      caretRef.current = start - 1
    } else {
      setTyped(typed.slice(0, start) + typed.slice(end))
      caretRef.current = start
    }
  }

  const hint = () => {
    if (!answerRaw) return
    setHintUsed(true)
    haptic('tap')
    const first = displayForms(answerRaw)[0] ?? ''
    const reveal = Array.from(first).slice(0, Math.max(1, Math.ceil(Array.from(first).length / 4)))
    setTyped(reveal.join(''))
    inputRef.current?.focus()
  }

  /* --- Render ------------------------------------------------------ */

  if (phase === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <Spinner />
      </div>
    )
  }

  if (phase === 'done' || !current || !template || !type) {
    const seen = [...done]
    return (
      <DoneScreen
        tally={tally}
        total={total}
        practice={practice}
        missedCount={missed.size}
        onExit={onExit}
        onMore={onMore}
        onRepeatAll={() => onRestart({ deckId: request.deckId, mode: 'repeat', cardIds: seen })}
        onRepeatMissed={() =>
          onRestart({ deckId: request.deckId, mode: 'repeat', cardIds: [...missed] })
        }
      />
    )
  }

  const progress = total === 0 ? 0 : tally.done / total
  const isRetype = phase === 'retype'
  const revealed = phase === 'result' || isRetype
  const modeLabel = request.mode === 'due' ? null : STUDY_MODES[request.mode].short
  const shownPrompt = isRetype ? (check?.best ?? promptText) : promptText
  // Beim Abtippen steht die Antwort oben — deren Aussprache zählt dann.
  const shownPromptPron = isRetype ? answerPron : promptPron

  return (
    <div className="flex min-h-dvh flex-col bg-ink" style={{ paddingTop: 'var(--safe-t)' }}>
      {/* Kopf: Ausstieg, Fortschritt, Richtung. Kein Streak, keine Ablenkung. */}
      <header className="flex items-center gap-3 px-3 py-3">
        <button
          onClick={onExit}
          aria-label="Session beenden"
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <ProgressBar value={progress} />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
            <span className="num">
              {tally.done} / {total}
            </span>
            <span className="truncate px-2">
              {deckName}
              {modeLabel && (
                <span className={practice ? 'text-warn' : 'text-accent-2'}> · {modeLabel}</span>
              )}
            </span>
            <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-medium text-muted">
              {template.short}
            </span>
          </div>
        </div>
      </header>

      {/* Frage */}
      <main
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-4"
        onClick={() => {
          if (advanceTimer.current !== null) {
            clearAdvance()
            setHeld(true)
          }
        }}
      >
        <div key={`${current.card.id}-${pos}`} className="animate-card-in w-full max-w-lg">
          {isRetype && (
            <p className="mb-3 text-center text-xs font-medium tracking-wide text-warn uppercase">
              Einmal richtig abtippen
            </p>
          )}

          <div className="text-center">
            <p
              className={cn(
                'font-medium break-words',
                template.inputLang === 'ru'
                  ? 'text-2xl text-text sm:text-3xl'
                  : 'font-ru text-4xl tracking-tight text-text sm:text-5xl',
              )}
              lang={template.promptField === 'ru' ? 'ru' : 'de'}
            >
              {shownPrompt}
            </p>
            {shownPromptPron && <Pronunciation text={shownPrompt} className="mt-2" />}
          </div>

          {/* Eingabe */}
          <div className="mt-7">
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={phase === 'result'}
              lang={template.inputLang}
              inputMode={cyrillic ? 'none' : 'text'}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={template.inputLang === 'ru' ? 'по-русски…' : 'auf Deutsch…'}
              aria-label="Antwort"
              className={cn(
                'w-full rounded-lg border-2 bg-surface px-4 py-3.5 text-center text-xl outline-none',
                'transition-colors duration-200 placeholder:text-faint',
                template.inputLang === 'ru' && 'font-ru',
                phase !== 'result' && 'border-line focus:border-accent/70',
                phase === 'result' &&
                  check?.verdict === 'correct' &&
                  'border-ok/60 bg-ok-dim text-ok',
                phase === 'result' && check?.verdict === 'near' && 'border-warn/60 bg-warn-dim',
                phase === 'result' && check?.verdict === 'wrong' && 'animate-shake border-bad/50 bg-bad-dim',
              )}
            />
          </div>

          {/* Ergebnis */}
          {revealed && check && phase === 'result' && (
            <Result
              check={check}
              answerRaw={answerRaw}
              note={current.note}
              template={template}
              nextDue={nextDue}
              practice={practice}
              pronounceAnswer={Boolean(answerPron)}
              showPronunciation={settings.showPronunciation}
              held={held}
              onUndo={undo}
            />
          )}

          {/* Hilfen vor dem Antworten */}
          {phase === 'prompt' && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={hint} disabled={hintUsed}>
                <Lightbulb className="size-3.5" />
                Hinweis
              </Button>
              <span className="text-faint">·</span>
              <Button variant="ghost" size="sm" onClick={giveUp}>
                <Eye className="size-3.5" />
                Weiß ich nicht
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Fuß: Tastatur oder Weiter */}
      <footer
        className="shrink-0 px-2 pb-2"
        style={{ paddingBottom: 'calc(0.5rem + var(--safe-b))' }}
      >
        {cyrillic ? (
          <CyrillicKeyboard
            onInsert={insert}
            onBackspace={backspace}
            onSubmit={phase === 'result' ? continueFromResult : isRetype ? retypeSubmit : submit}
            submitLabel={phase === 'result' ? 'Weiter' : 'Prüfen'}
            lettersDisabled={phase === 'result'}
          />
        ) : (
          <div className="mx-auto max-w-lg px-1">
            {phase === 'result' ? (
              <Button variant="accent" size="lg" block onClick={continueFromResult}>
                Weiter <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                variant="accent"
                size="lg"
                block
                onClick={isRetype ? retypeSubmit : submit}
                disabled={!typed.trim()}
              >
                {isRetype ? 'Bestätigen' : 'Prüfen'} <Check className="size-4" />
              </Button>
            )}
          </div>
        )}
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Ergebnisblock
 * ------------------------------------------------------------------ */

function Result({
  check,
  answerRaw,
  note,
  template,
  nextDue,
  practice,
  pronounceAnswer,
  showPronunciation,
  held,
  onUndo,
}: {
  check: AnswerCheck
  answerRaw: string
  note: StudyCard['note']
  template: NonNullable<ReturnType<typeof templateOf>>
  nextDue: number | null
  practice: boolean
  pronounceAnswer: boolean
  showPronunciation: boolean
  held: boolean
  onUndo: () => void
}) {
  const alternatives = displayForms(answerRaw).filter((f) => f !== check.best)
  const context = template.revealFields
    .map((key) => ({
      key,
      value: note.fields[key] ?? '',
      pronounce: showPronunciation ? fieldOf(note.noteTypeId, key)?.pronounce : undefined,
    }))
    .filter((f) => f.value.trim())

  return (
    <div className="animate-rise mt-5">
      {check.verdict !== 'correct' && (
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-faint uppercase">
            {check.verdict === 'near' ? 'Knapp daneben' : 'Richtig wäre'}
          </p>
          <p className="font-ru mt-1.5 text-2xl font-medium break-words">{check.best}</p>
          {check.verdict === 'near' && (
            <div className="mt-2">
              <Diff segments={check.diff} />
            </div>
          )}
        </div>
      )}

      {check.verdict === 'correct' && check.lenient && (
        <p className="text-center text-xs text-muted">
          Gezählt als richtig — exakt: <span className="font-ru font-medium">{check.best}</span>
        </p>
      )}

      {pronounceAnswer && <Pronunciation text={check.best} className="mt-1.5" />}

      {alternatives.length > 0 && (
        <p className="mt-2 text-center text-xs text-faint">
          auch richtig: <span className="font-ru">{alternatives.join(' · ')}</span>
        </p>
      )}

      {context.length > 0 && (
        <div className="mt-4 space-y-1.5 rounded-md border border-line-soft bg-surface px-3.5 py-3">
          {context.map((f) => (
            <div key={f.key} className="text-sm leading-snug text-muted">
              <p className="font-ru text-text">
                <InlinePronunciation text={f.value} enabled={f.pronounce === 'inline'} />
              </p>
              {f.pronounce === true && (
                <Pronunciation text={f.value} size="sm" className="mt-0.5 justify-start" />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-faint">
        {practice ? (
          <span>Übung · Planung unverändert</span>
        ) : (
          nextDue !== null && <span className="num">wieder {dueLabel(nextDue)}</span>
        )}
        <span>·</span>
        <button onClick={onUndo} className="underline decoration-dotted hover:text-muted">
          Antwort zurücknehmen
        </button>
      </div>

      {held && (
        <p className="mt-2 text-center text-[11px] text-faint">
          Angehalten — mit Enter oder „Weiter“ geht es los.
        </p>
      )}
    </div>
  )
}

function Diff({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="font-ru text-lg">
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(
            s.type === 'same' && 'text-muted',
            s.type === 'missing' && 'rounded-[3px] bg-ok/20 px-0.5 font-semibold text-ok',
            s.type === 'extra' && 'text-bad line-through decoration-2',
          )}
        >
          {s.text}
        </span>
      ))}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * Abschluss — der Moment, der zum Wiederkommen einlädt
 * ------------------------------------------------------------------ */

function DoneScreen({
  tally,
  total,
  practice,
  missedCount,
  onExit,
  onMore,
  onRepeatAll,
  onRepeatMissed,
}: {
  tally: SessionTally
  total: number
  practice: boolean
  missedCount: number
  onExit: () => void
  onMore: () => void
  onRepeatAll: () => void
  onRepeatMissed: () => void
}) {
  const answered = tally.correct + tally.near + tally.wrong
  const acc = answered === 0 ? 0 : Math.round((tally.correct / answered) * 100)
  const minutes = Math.max(1, Math.round(tally.durationMs / 60_000))

  const line = useMemo(() => {
    if (total === 0) {
      return practice
        ? 'Hier gibt es gerade nichts zu üben.'
        : 'Für heute ist alles erledigt. Weiterlernen geht trotzdem.'
    }
    if (acc >= 90) return 'Sitzt.'
    if (acc >= 70) return 'Solide Runde.'
    if (acc >= 50) return 'Dranbleiben lohnt sich — genau diese Karten kommen wieder.'
    return 'Harte Runde. Genau so wird daraus Wissen.'
  }, [acc, total])

  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-6">
      <div className="animate-pop w-full max-w-sm text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-ok-dim text-ok">
          <Check className="size-8" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {total === 0
            ? practice
              ? 'Nichts zu üben'
              : 'Nichts fällig'
            : practice
              ? 'Übung fertig'
              : 'Session fertig'}
        </h1>
        <p className="mt-1.5 text-sm text-muted">{line}</p>

        {total > 0 && (
          <div className="mt-7 grid grid-cols-3 gap-2">
            <Tile value={`${tally.done}`} label="Karten" />
            <Tile value={`${acc}%`} label="Treffer" tone={acc >= 70 ? 'ok' : undefined} />
            <Tile value={`${minutes} min`} label="Zeit" />
          </div>
        )}

        {tally.learnedNew > 0 && (
          <p className="num mt-3 text-xs text-accent-2">
            {tally.learnedNew} neue {tally.learnedNew === 1 ? 'Karte' : 'Karten'} zum ersten Mal
            gesehen
          </p>
        )}
        {practice && total > 0 && (
          <p className="mt-3 text-xs text-faint">Übung — die Fälligkeiten bleiben, wie sie waren.</p>
        )}

        {total > 0 ? (
          <>
            <div className="mt-8 space-y-2">
              {missedCount > 0 && (
                <Button variant="surface" block onClick={onRepeatMissed}>
                  <Target className="size-4" />
                  Fehler üben · <span className="num">{missedCount}</span>
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="surface" block onClick={onRepeatAll}>
                  <RotateCcw className="size-4" />
                  Nochmal üben
                </Button>
                <Button variant="surface" block onClick={onMore}>
                  <Dumbbell className="size-4" />
                  Mehr lernen
                </Button>
              </div>
            </div>
            <Button variant="accent" size="lg" block className="mt-3" onClick={onExit}>
              Fertig
            </Button>
          </>
        ) : (
          <div className="mt-8 space-y-2">
            <Button variant="accent" size="lg" block onClick={onMore}>
              <Dumbbell className="size-4" />
              Mehr lernen
            </Button>
            <Button variant="ghost" block onClick={onExit}>
              Zurück
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'ok' }) {
  return (
    <div className="rounded-md border border-line-soft bg-surface px-2 py-3">
      <div className={cn('num text-lg font-semibold', tone === 'ok' && 'text-ok')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{label}</div>
    </div>
  )
}
