/**
 * Mikro-Feedback. Auf iOS-Safari ist `vibrate` nicht verfügbar — dann still
 * scheitern statt Feature-Detection an jeder Aufrufstelle.
 */
type Kind = 'tap' | 'ok' | 'near' | 'bad' | 'done'

const PATTERNS: Record<Kind, number | number[]> = {
  tap: 8,
  ok: 14,
  near: [12, 40, 12],
  bad: [26, 50, 26],
  done: [16, 60, 16, 60, 40],
}

let enabled = true

export function setHapticsEnabled(v: boolean) {
  enabled = v
}

export function haptic(kind: Kind) {
  if (!enabled) return
  try {
    navigator.vibrate?.(PATTERNS[kind])
  } catch {
    /* egal */
  }
}
