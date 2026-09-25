import { useEffect, useState } from 'react'

/**
 * Vorlesen über die Web Speech API — ausschließlich mit Stimmen, die auf dem
 * Gerät laufen (`localService`). Netzstimmen wie „Google русский“ in Chrome
 * schicken den Text an einen Server; das bricht „nichts verlässt das Gerät“.
 * Gibt es keine lokale Stimme für die Sprache, gibt es keinen Vorlese-Knopf.
 */

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function localVoice(lang: string): SpeechSynthesisVoice | null {
  if (!supported()) return null
  const prefix = lang.toLowerCase()
  const voices = window.speechSynthesis
    .getVoices()
    .filter((v) => v.localService && v.lang.toLowerCase().startsWith(prefix))
  return voices.find((v) => v.default) ?? voices[0] ?? null
}

/** Lokale Stimme, reaktiv — die Stimmenliste lädt in manchen Browsern verzögert. */
export function useLocalVoice(lang: string): SpeechSynthesisVoice | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(() => localVoice(lang))

  useEffect(() => {
    if (!supported()) return
    const update = () => setVoice(localVoice(lang))
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [lang])

  return voice
}

export function speak(text: string, voice: SpeechSynthesisVoice): void {
  if (!supported() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voice
  u.lang = voice.lang
  // Etwas langsamer als Standard: es geht ums Hinhören, nicht ums Tempo.
  u.rate = 0.85
  synth.speak(u)
}
