import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_SETTINGS, type AppSettings } from './types'
import { loadSettings, saveSetting } from './repo'
import { setHapticsEnabled } from '@/lib/haptics'
import { setSoundEnabled } from '@/lib/sound'

/** Einstellungen reaktiv. Fällt bis zum ersten Laden auf die Vorgaben zurück. */
export function useSettings(): AppSettings {
  const settings = useLiveQuery(() => loadSettings(), [], DEFAULT_SETTINGS)

  useEffect(() => {
    setHapticsEnabled(settings.haptics)
    setSoundEnabled(settings.sound)
  }, [settings.haptics, settings.sound])

  return settings
}

export { saveSetting }
