/**
 * Dauerhafter Speicher.
 *
 * Browser-Storage ist standardmäßig „best effort“: der Browser darf ihn unter
 * Speicherdruck räumen. `navigator.storage.persist()` hebt eine Origin auf
 * „persistent“ — dann wird nur noch auf ausdrückliche Anweisung des Nutzers
 * gelöscht.
 *
 * Ob die Anfrage gewährt wird, entscheidet der Browser heuristisch (installiert,
 * häufig benutzt, gebookmarkt). Sie kann also scheitern, und das ist kein
 * Fehlerfall — es ist der Grund, warum der Export existiert. Die lokale
 * Datenbank bleibt ein Cache; dauerhaft sind Backup und später der Sync.
 */

export interface StorageState {
  supported: boolean
  persisted: boolean
  usageBytes: number | null
  quotaBytes: number | null
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}

/** Gibt zurück, ob die Origin danach dauerhaft ist. Fragt nur, wenn nötig. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await isPersisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageState(): Promise<StorageState> {
  const supported = Boolean(navigator.storage?.persist)
  let usageBytes: number | null = null
  let quotaBytes: number | null = null
  try {
    const est = await navigator.storage?.estimate?.()
    usageBytes = est?.usage ?? null
    quotaBytes = est?.quota ?? null
  } catch {
    /* Schätzung ist optional */
  }
  return { supported, persisted: await isPersisted(), usageBytes, quotaBytes }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[i]}`
}
