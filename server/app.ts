/**
 * HTTP-Schicht des Sync-Servers, ohne Node-Server drumherum — damit sie sich
 * direkt testen lässt. `main.ts` hängt sie an `node:http`.
 *
 * Authentifizierung: `Authorization: Bearer <token>`. Der Token wird auf dem
 * Gerät aus dem Sync-Schlüssel abgeleitet; der Server speichert nur dessen
 * SHA-256 als Raum-ID. Den Schlüssel selbst — und damit den Klartext der
 * Daten — sieht er nie.
 */
import { createHash } from 'node:crypto'
import { COLLECTIONS, SpaceLimitError, type SyncStore, type WireRecord } from './store.ts'

export const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_RECORDS = 1000
const MAX_RECORD_BYTES = 256 * 1024
const PULL_LIMIT = 1000

export interface Reply {
  status: number
  body: unknown
}

export function handle(
  store: SyncStore,
  method: string,
  path: string,
  authorization: string | undefined,
  rawBody: string,
): Reply {
  if (method === 'GET' && path === '/api/sync/health') return { status: 200, body: { ok: true } }
  if (method !== 'POST' || (path !== '/api/sync/push' && path !== '/api/sync/pull')) {
    return { status: 404, body: { error: 'Unbekannter Pfad.' } }
  }

  const token = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? '')?.[1]
  if (!token) return { status: 401, body: { error: 'Sync-Schlüssel fehlt oder ist ungültig.' } }
  const space = createHash('sha256').update(token).digest('hex')

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    return { status: 400, body: { error: 'Kein gültiges JSON.' } }
  }

  const device = body.device
  if (typeof device !== 'string' || device.length < 1 || device.length > 64) {
    return { status: 400, body: { error: '`device` fehlt.' } }
  }

  if (path === '/api/sync/pull') {
    const since = body.since
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0) {
      return { status: 400, body: { error: '`since` fehlt.' } }
    }
    const limit = typeof body.limit === 'number' && Number.isSafeInteger(body.limit) ? body.limit : PULL_LIMIT
    return { status: 200, body: store.pull(space, device, since, Math.min(Math.max(limit, 1), PULL_LIMIT)) }
  }

  const records = parseRecords(body.records)
  if (typeof records === 'string') return { status: 400, body: { error: records } }
  try {
    return { status: 200, body: store.push(space, device, records) }
  } catch (e) {
    if (e instanceof SpaceLimitError) return { status: 403, body: { error: e.message } }
    throw e
  }
}

function parseRecords(raw: unknown): WireRecord[] | string {
  if (!Array.isArray(raw)) return '`records` fehlt.'
  if (raw.length > MAX_RECORDS) return `Höchstens ${MAX_RECORDS} Datensätze pro Anfrage.`
  const out: WireRecord[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return 'Ungültiger Datensatz.'
    const { c, id, u, del, d } = r as Record<string, unknown>
    if (!(COLLECTIONS as readonly unknown[]).includes(c)) return 'Unbekannte Sammlung.'
    if (typeof id !== 'string' || id.length < 1 || id.length > 200) return 'Ungültige ID.'
    if (typeof u !== 'number' || !Number.isSafeInteger(u) || u < 0) return 'Ungültige Version.'
    if (del === true) {
      out.push({ c: c as WireRecord['c'], id, u, del: true })
      continue
    }
    if (typeof d !== 'string' || d.length > MAX_RECORD_BYTES) return 'Ungültiger Inhalt.'
    out.push({ c: c as WireRecord['c'], id, u, d })
  }
  return out
}
