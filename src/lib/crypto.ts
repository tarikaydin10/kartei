/**
 * Ende-zu-Ende-Verschlüsselung für den Sync. Alles über WebCrypto, nichts
 * Eigenes an Kryptografie.
 *
 * Der Sync-Schlüssel ist das einzige Geheimnis: 128 Bit Zufall plus 32 Bit
 * Prüfsumme, als 32 Zeichen Crockford-Base32 („K7Q2-…“) zum Abtippen. Die
 * Prüfsumme fängt Tippfehler ab — ein vertippter Schlüssel wäre sonst ein
 * gültiger, leerer Raum, und zwei Geräte liefen still auseinander.
 *
 * Aus dem Schlüssel entstehen per HKDF zwei unabhängige Werte:
 *   - der Token, mit dem sich das Gerät beim Server ausweist,
 *   - der AES-GCM-Schlüssel für die Inhalte. Der verlässt das Gerät nie.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RANDOM_BYTES = 16
const CHECK_BYTES = 4

/** Neuer Sync-Schlüssel, formatiert zum Anzeigen. */
export function generateSyncKey(): string {
  const random = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES))
  return formatSyncKey(encode(withCheck(random)))
}

/**
 * Eingabe prüfen und in die kanonische Form bringen. Verzeiht Kleinschreibung,
 * Leerzeichen, Bindestriche und die üblichen Verwechslungen (O/0, I/L/1).
 * `null` bei falscher Länge oder Prüfsumme.
 */
export function normalizeSyncKey(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (s.length !== 32 || [...s].some((ch) => !ALPHABET.includes(ch))) return null
  const bytes = decode(s)
  const random = bytes.slice(0, RANDOM_BYTES)
  const expected = withCheck(random)
  if (!expected.every((b, i) => b === bytes[i])) return null
  return formatSyncKey(s)
}

export function formatSyncKey(key: string): string {
  const s = key.replace(/-/g, '')
  return s.match(/.{1,4}/g)!.join('-')
}

export interface SyncKeys {
  /** Hex, 64 Zeichen — Ausweis beim Server. */
  token: string
  /** AES-GCM-256 für die Inhalte. */
  key: CryptoKey
}

export async function deriveSyncKeys(syncKey: string): Promise<SyncKeys> {
  const canonical = normalizeSyncKey(syncKey)
  if (!canonical) throw new Error('Ungültiger Sync-Schlüssel.')
  const base = await crypto.subtle.importKey('raw', toBuffer(decode(canonical.replace(/-/g, ''))), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])
  const salt = utf8('kartei-sync-v1')
  const tokenBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('token') },
    base,
    256,
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('content') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { token: hex(new Uint8Array(tokenBits)), key }
}

/**
 * Verschlüsseln. `context` (Sammlung, ID, Version) wird mit authentifiziert:
 * Der Server kann Chiffretexte weder zwischen Datensätzen vertauschen noch
 * einer alten Fassung eine neue Version umhängen.
 */
export async function seal(key: CryptoKey, context: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(context) },
    key,
    utf8(JSON.stringify(value)),
  )
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), iv.length)
  return base64(out)
}

export async function unseal<T>(key: CryptoKey, context: string, sealed: string): Promise<T> {
  const bytes = unbase64(sealed)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(context) },
    key,
    bytes.slice(12),
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/* --- Kodierung ------------------------------------------------------ */

function withCheck(random: Uint8Array): Uint8Array {
  // FNV-1a über die Zufallsbytes — kein Schutz gegen Absicht, nur gegen Tippfehler.
  let h = 0x811c9dc5
  for (const b of random) h = Math.imul(h ^ b, 0x01000193) >>> 0
  const out = new Uint8Array(RANDOM_BYTES + CHECK_BYTES)
  out.set(random)
  out.set([h >>> 24, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff], RANDOM_BYTES)
  return out
}

function encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function utf8(s: string): ArrayBuffer {
  return toBuffer(new TextEncoder().encode(s))
}

/** WebCrypto will einen eigenen ArrayBuffer, keine Sicht auf einen größeren. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function unbase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
