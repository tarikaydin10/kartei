/**
 * Wann abgeglichen wird, und der Status für die Oberfläche.
 *
 * Automatisch: beim Start, wenn das Netz zurückkommt, wenn die App wieder in
 * den Vordergrund kommt, beim Verlassen, alle fünf Minuten im Vordergrund und
 * kurz nach jeder lokalen Änderung. Kein Knopf nötig — der in den Einstellungen
 * ist für die Beruhigung.
 */
import { useSyncExternalStore } from 'react'
import Dexie from 'dexie'
import { loadSyncConfig, syncNow, SyncError, type SyncErrorKind, type SyncSummary } from './sync'

export interface SyncStatus {
  configured: boolean
  running: boolean
  lastSyncAt: number | null
  error: string | null
  errorKind: SyncErrorKind | null
}

let status: SyncStatus = { configured: false, running: false, lastSyncAt: null, error: null, errorKind: null }
const listeners = new Set<() => void>()

function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const l of listeners) l()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )
}

export async function refreshSyncStatus(): Promise<void> {
  const cfg = await loadSyncConfig()
  set({ configured: cfg !== null, lastSyncAt: cfg?.lastSyncAt ?? null, ...(cfg ? {} : { error: null, errorKind: null }) })
}

/**
 * Einen Abgleich anstoßen und den Status nachführen. Fehler landen im Status;
 * mit `rethrow` zusätzlich beim Aufrufer (für den Knopf „Jetzt abgleichen“).
 */
export async function runSync(opts: { rethrow?: boolean } = {}): Promise<SyncSummary | null> {
  set({ running: true })
  try {
    const result = await syncNow()
    await refreshSyncStatus()
    set({ error: null, errorKind: null })
    return result
  } catch (e) {
    const kind = e instanceof SyncError ? e.kind : 'server'
    set({ error: (e as Error).message, errorKind: kind })
    if (opts.rethrow) throw e
    return null
  } finally {
    set({ running: false })
  }
}

const INTERVAL_MS = 5 * 60_000
const AFTER_CHANGE_MS = 8_000
/** Tabellen, deren Änderung einen Abgleich auslöst. */
const SYNCED_TABLES = /^idb:\/\/[^/]+\/(decks|notes|cards|reviews)\//

/** Automatischen Abgleich starten. Gibt eine Aufräumfunktion zurück. */
export function startAutoSync(): () => void {
  let debounce: number | undefined
  const soon = () => {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void maybeSync(), AFTER_CHANGE_MS)
  }
  const maybeSync = async () => {
    if (!status.configured) await refreshSyncStatus()
    if (status.configured && navigator.onLine !== false) await runSync()
  }

  const onVisibility = () => void maybeSync()
  const onMutated = (parts: Record<string, unknown>) => {
    if (Object.keys(parts).some((k) => SYNCED_TABLES.test(k))) soon()
  }
  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible') void maybeSync()
  }, INTERVAL_MS)

  window.addEventListener('online', onVisibility)
  document.addEventListener('visibilitychange', onVisibility)
  Dexie.on('storagemutated', onMutated)
  void refreshSyncStatus().then(maybeSync)

  return () => {
    window.clearTimeout(debounce)
    window.clearInterval(interval)
    window.removeEventListener('online', onVisibility)
    document.removeEventListener('visibilitychange', onVisibility)
    Dexie.on('storagemutated').unsubscribe(onMutated)
  }
}
