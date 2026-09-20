/**
 * Zwei kurze Töne, per WebAudio erzeugt — keine Audiodateien, nichts zu laden,
 * funktioniert offline. Standardmäßig aus; wer es mag, schaltet es ein.
 */
let ctx: AudioContext | null = null
let enabled = false

export function setSoundEnabled(v: boolean) {
  enabled = v
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function blip(freq: number, durationMs: number, gain = 0.06, type: OscillatorType = 'sine') {
  const ac = audio()
  if (!ac) return
  const osc = ac.createOscillator()
  const vol = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const now = ac.currentTime
  const end = now + durationMs / 1000
  vol.gain.setValueAtTime(0, now)
  vol.gain.linearRampToValueAtTime(gain, now + 0.01)
  vol.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.connect(vol).connect(ac.destination)
  osc.start(now)
  osc.stop(end + 0.02)
}

export const sound = {
  correct: () => {
    blip(660, 90)
    setTimeout(() => blip(880, 110), 70)
  },
  near: () => blip(420, 140, 0.05, 'triangle'),
  wrong: () => blip(190, 190, 0.05, 'triangle'),
  done: () => {
    ;[523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 140), i * 90))
  },
}
