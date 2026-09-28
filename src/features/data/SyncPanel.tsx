import { useEffect, useState } from 'react'
import { Cloud, CloudOff, Copy, KeyRound, Link2, MonitorSmartphone, RefreshCw, Unlink } from 'lucide-react'
import { connectSync, disconnectSync, loadSyncConfig, probeSyncKey } from '@/data/sync'
import { refreshSyncStatus, runSync, useSyncStatus } from '@/data/useSync'
import { generateSyncKey, normalizeSyncKey } from '@/lib/crypto'
import { agoLabel } from '@/lib/date'
import { cn } from '@/lib/cn'
import { Button, Panel, SectionTitle } from '@/ui/primitives'
import { Input } from '@/ui/Field'
import { ConfirmSheet, Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'

/**
 * Geräte verbinden. Kein Konto: ein Sync-Schlüssel, den jedes Gerät einmal
 * bekommt. Er authentifiziert beim Server und verschlüsselt die Inhalte —
 * der Server sieht nie, was auf den Karten steht.
 */
export function SyncPanel() {
  const toast = useToast()
  const sync = useSyncStatus()
  const [sheet, setSheet] = useState<'create' | 'join' | 'show' | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  useEffect(() => {
    void refreshSyncStatus()
  }, [])

  const syncNowManually = async () => {
    try {
      const r = await runSync({ rethrow: true })
      if (r) toast.show(r.pulled + r.pushed === 0 ? 'Alles auf dem neuesten Stand' : 'Abgeglichen', { tone: 'ok' })
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' })
    }
  }

  const offline = sync.errorKind === 'offline'

  return (
    <div className="mt-6">
      <SectionTitle>Geräte</SectionTitle>
      {sync.configured ? (
        <Panel className="divide-y divide-line-soft overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span className={cn('mt-0.5 shrink-0', offline ? 'text-faint' : sync.error ? 'text-bad' : 'text-ok')}>
              {offline ? <CloudOff className="size-[18px]" /> : <Cloud className="size-[18px]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">
                {sync.running ? 'Gleicht ab …' : offline ? 'Offline' : sync.error ? 'Sync angehalten' : 'Sync aktiv'}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-faint">
                {offline
                  ? 'Du lernst lokal weiter. Sobald wieder Netz da ist, wird abgeglichen.'
                  : (sync.error ??
                    (sync.lastSyncAt
                      ? `Zuletzt abgeglichen ${agoLabel(sync.lastSyncAt)}.`
                      : 'Noch nicht abgeglichen.'))}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={syncNowManually} disabled={sync.running} aria-label="Jetzt abgleichen">
              <RefreshCw className={cn('size-4', sync.running && 'animate-spin')} />
            </Button>
          </div>
          <Row
            icon={<KeyRound className="size-[18px]" />}
            title="Weiteres Gerät verbinden"
            body="Zeigt den Sync-Schlüssel, den du dort eingibst."
            onClick={() => setSheet('show')}
          />
          <Row
            icon={<Unlink className="size-[18px]" />}
            title="Verbindung trennen"
            body="Dieses Gerät gleicht nicht mehr ab. Lokale Daten bleiben."
            onClick={() => setConfirmDisconnect(true)}
          />
        </Panel>
      ) : (
        <Panel className="divide-y divide-line-soft overflow-hidden">
          <Row
            icon={<MonitorSmartphone className="size-[18px]" />}
            title="Sync einrichten"
            body="Auf dem ersten Gerät. Erzeugt einen Schlüssel für alle weiteren."
            onClick={() => setSheet('create')}
          />
          <Row
            icon={<Link2 className="size-[18px]" />}
            title="Mit bestehendem Sync verbinden"
            body="Schlüssel von einem anderen Gerät eingeben. Beide Bestände werden vereinigt."
            onClick={() => setSheet('join')}
          />
        </Panel>
      )}
      <p className="mt-2 px-1 text-[11px] leading-snug text-faint">
        Offline zuerst: gelernt wird immer lokal, abgeglichen im Hintergrund. Die Inhalte sind Ende zu
        Ende verschlüsselt — der Server kann sie nicht lesen.
      </p>

      {sheet === 'create' && <CreateSheet onClose={() => setSheet(null)} />}
      {sheet === 'join' && <JoinSheet onClose={() => setSheet(null)} />}
      {sheet === 'show' && <ShowKeySheet onClose={() => setSheet(null)} />}

      <ConfirmSheet
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={async () => {
          await disconnectSync()
          await refreshSyncStatus()
          setConfirmDisconnect(false)
          toast.show('Verbindung getrennt', { tone: 'ok' })
        }}
        title="Verbindung trennen?"
        body="Dieses Gerät gleicht danach nicht mehr ab. Alle Daten bleiben hier und auf dem Server; mit dem Schlüssel lässt es sich jederzeit wieder verbinden."
        confirmLabel="Trennen"
      />
    </div>
  )
}

function Row({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-faint">{body}</span>
      </span>
    </button>
  )
}

function KeyBox({ value }: { value: string }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.show('Schlüssel kopiert', { tone: 'ok' })
    } catch {
      toast.show('Kopieren nicht möglich — bitte abschreiben', { tone: 'bad' })
    }
  }
  return (
    <div className="rounded-md border border-accent/30 bg-accent-dim px-3.5 py-3">
      <p className="num text-center font-mono text-[17px] leading-relaxed tracking-wide break-all select-all">
        {value}
      </p>
      <div className="mt-2 flex justify-center">
        <Button variant="ghost" size="sm" onClick={copy}>
          <Copy className="size-3.5" /> Kopieren
        </Button>
      </div>
    </div>
  )
}

const KEY_WARNING =
  'Der Schlüssel ist der einzige Zugang zu deinen synchronisierten Daten und entschlüsselt sie. ' +
  'Bewahre ihn auf wie ein Passwort, etwa im Passwortmanager. Geht er verloren, bleiben die Daten ' +
  'auf deinen Geräten — du richtest dann einfach einen neuen Sync ein.'

function CreateSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [key] = useState(generateSyncKey)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      await connectSync(key, { joining: false })
      await refreshSyncStatus()
      await runSync({ rethrow: true })
      toast.show('Sync eingerichtet', { tone: 'ok' })
      onClose()
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Sync einrichten"
      footer={
        <Button variant="accent" block disabled={busy} onClick={() => void start()}>
          {busy ? 'Richte ein …' : 'Schlüssel gesichert — einrichten'}
        </Button>
      }
    >
      <div className="space-y-4 text-sm leading-snug text-muted">
        <p>Dein Sync-Schlüssel. Auf jedem weiteren Gerät gibst du ihn einmal ein.</p>
        <KeyBox value={key} />
        <p className="text-xs text-faint">{KEY_WARNING}</p>
      </div>
    </Sheet>
  )
}

function JoinSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** Server kennt den Schlüssel noch nicht — einmal nachfragen. */
  const [unknownKey, setUnknownKey] = useState(false)
  const key = normalizeSyncKey(input)

  const join = async () => {
    if (!key) return
    setBusy(true)
    try {
      const { exists } = await probeSyncKey(key)
      if (!exists && !unknownKey) {
        setUnknownKey(true)
        return
      }
      await connectSync(key, { joining: exists })
      await refreshSyncStatus()
      const r = await runSync({ rethrow: true })
      toast.show(r && r.pulled > 0 ? 'Verbunden — Daten übernommen' : 'Verbunden', { tone: 'ok' })
      onClose()
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Mit bestehendem Sync verbinden"
      footer={
        <Button variant="accent" block disabled={!key || busy} onClick={() => void join()}>
          {busy ? 'Verbinde …' : unknownKey ? 'Trotzdem verbinden' : 'Verbinden'}
        </Button>
      }
    >
      <div className="space-y-3">
        <Input
          label="Sync-Schlüssel"
          hint="Steht auf dem anderen Gerät unter Daten → Geräte → Weiteres Gerät verbinden."
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setUnknownKey(false)
          }}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="font-mono tracking-wide"
          autoFocus
        />
        {input.trim() && !key && (
          <p className="text-xs text-bad">Das ist kein gültiger Schlüssel — ein Zeichen zu viel, zu wenig oder vertippt.</p>
        )}
        {unknownKey && (
          <p className="text-xs leading-snug text-warn">
            Unter diesem Schlüssel liegen noch keine Daten. Wurde der Sync auf dem anderen Gerät schon
            eingerichtet und einmal abgeglichen?
          </p>
        )}
        <p className="text-xs leading-snug text-faint">
          Was schon auf diesem Gerät liegt, bleibt und wird mit dem Bestand der anderen Geräte vereinigt.
          Lernfortschritt geht dabei nicht verloren.
        </p>
      </div>
    </Sheet>
  )
}

function ShowKeySheet({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    void loadSyncConfig().then((c) => setKey(c?.key ?? null))
  }, [])
  return (
    <Sheet open onClose={onClose} title="Weiteres Gerät verbinden">
      <div className="space-y-4 text-sm leading-snug text-muted">
        <p>
          Auf dem neuen Gerät Kartei öffnen, dann <span className="text-text">Daten → Geräte → Mit bestehendem
          Sync verbinden</span> und diesen Schlüssel eingeben.
        </p>
        {key && <KeyBox value={key} />}
        <p className="text-xs text-faint">{KEY_WARNING}</p>
      </div>
    </Sheet>
  )
}
