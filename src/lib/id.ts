/** UUIDs statt Auto-Increment: Voraussetzung für konfliktfreien Sync später. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Fallback für sehr alte WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Deterministische ID aus Bestandteilen — gleiche Eingabe, gleiche ID, auf
 * jedem Gerät. Für Datensätze, die zwei Geräte unabhängig voneinander anlegen
 * können und die danach *eine* sein sollen (dasselbe Deck zweimal importiert).
 *
 * Synchron und ohne WebCrypto, weil sie innerhalb von Dexie-Transaktionen
 * gebraucht wird: dort beendet jedes fremde `await` die Transaktion. 128 Bit
 * aus vier unabhängig geseedeten 32-Bit-Hashes, im UUID-Format (Version 8).
 */
export function stableId(...parts: string[]): string {
  const input = parts.join('\u0000')
  const h = [0x9e3779b1, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f].map((seed) => {
    let x = seed ^ input.length
    for (let i = 0; i < input.length; i++) {
      x = Math.imul(x ^ input.charCodeAt(i), 0x5bd1e995)
      x ^= x >>> 15
    }
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
    return (x ^ (x >>> 16)) >>> 0
  })
  const hex = h.map((n) => n.toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Eine Karte ist Notiz × Richtung — ihre ID ergibt sich daraus. So legen zwei
 * Geräte für dieselbe Notiz dieselbe Karte an, und der Verlauf beider Geräte
 * landet beim Sync auf *einer* Karte statt auf zwei.
 */
export function cardIdFor(noteId: string, templateId: string): string {
  return `${noteId}:${templateId}`
}
