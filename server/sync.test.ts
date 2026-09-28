// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SyncStore, type WireRecord } from './store.ts'
import { handle } from './app.ts'

const TOKEN = 'a'.repeat(64)
const AUTH = `Bearer ${TOKEN}`

function setup(maxSpaces = 10) {
  const store = new SyncStore(new DatabaseSync(':memory:'), maxSpaces)
  const call = (path: string, body: unknown, auth = AUTH) =>
    handle(store, 'POST', `/api/sync/${path}`, auth, JSON.stringify(body))
  const push = (device: string, records: WireRecord[], auth = AUTH) =>
    call('push', { device, records }, auth).body as { rejected: WireRecord[] }
  const pull = (device: string, since = 0, auth = AUTH) =>
    call('pull', { device, since }, auth).body as {
      records: WireRecord[]
      cursor: number
      more: boolean
      exists: boolean
    }
  return { store, call, push, pull }
}

const note = (id: string, u: number, d = `cipher-${id}-${u}`): WireRecord => ({ c: 'notes', id, u, d })

describe('Sync-Server', () => {
  it('liefert Änderungen anderer Geräte, nicht die eigenen', () => {
    const { push, pull } = setup()
    push('A', [note('n1', 100)])
    expect(pull('A').records).toEqual([])
    expect(pull('B').records).toEqual([note('n1', 100)])
  })

  it('nimmt nur strikt Neueres an und nennt bei Ablehnung den geltenden Stand', () => {
    const { push, pull } = setup()
    push('A', [note('n1', 100, 'neu')])
    expect(push('B', [note('n1', 90, 'alt')]).rejected).toEqual([note('n1', 100, 'neu')])
    // Gleichstand: der Bestand bleibt.
    expect(push('B', [note('n1', 100, 'anders')]).rejected).toEqual([note('n1', 100, 'neu')])
    expect(push('B', [note('n1', 110, 'neuer')]).rejected).toEqual([])
    expect(pull('A').records).toEqual([note('n1', 110, 'neuer')])
  })

  it('ein Löschmarker bleibt, auch wenn das Review erneut gesendet wird', () => {
    const { push, pull } = setup()
    const review: WireRecord = { c: 'reviews', id: 'r1', u: 100, d: 'x' }
    push('A', [review])
    push('A', [{ c: 'reviews', id: 'r1', u: 200, del: true }])
    expect(push('B', [review]).rejected).toEqual([{ c: 'reviews', id: 'r1', u: 200, del: true }])
    expect(pull('C').records).toEqual([{ c: 'reviews', id: 'r1', u: 200, del: true }])
  })

  it('holt über den Cursor nur Neues ab', () => {
    const { push, pull } = setup()
    push('A', [note('n1', 1)])
    const first = pull('B')
    push('A', [note('n2', 2)])
    expect(pull('B', first.cursor).records).toEqual([note('n2', 2)])
    expect(pull('B', pull('B').cursor).records).toEqual([])
  })

  it('blättert große Mengen seitenweise', () => {
    const { push, pull } = setup()
    const many = Array.from({ length: 1000 }, (_, i) => note(`n${i}`, 1))
    push('A', many)
    push('A', [note('x', 1)])
    const page1 = pull('B')
    expect(page1.more).toBe(true)
    expect(page1.records).toHaveLength(1000)
    const page2 = pull('B', page1.cursor)
    expect(page2.more).toBe(false)
    expect(page2.records).toEqual([note('x', 1)])
  })

  it('trennt Räume nach Schlüssel', () => {
    const { push, pull } = setup()
    push('A', [note('n1', 1)])
    const other = `Bearer ${'b'.repeat(64)}`
    expect(pull('B', 0, other)).toMatchObject({ records: [], exists: false })
    expect(pull('B')).toMatchObject({ exists: true })
  })

  it('begrenzt die Zahl der Räume', () => {
    const { call } = setup(1)
    expect(call('push', { device: 'A', records: [note('n1', 1)] }).status).toBe(200)
    const reply = call('push', { device: 'A', records: [note('n1', 1)] }, `Bearer ${'c'.repeat(64)}`)
    expect(reply.status).toBe(403)
  })

  it('weist Anfragen ohne gültigen Schlüssel und kaputte Datensätze ab', () => {
    const { call } = setup()
    expect(call('pull', { device: 'A', since: 0 }, 'Bearer kurz').status).toBe(401)
    expect(call('pull', { device: 'A', since: 0 }, '').status).toBe(401)
    expect(call('push', { device: 'A', records: [{ c: 'evil', id: 'x', u: 1, d: '' }] }).status).toBe(400)
    expect(call('push', { device: 'A', records: [{ c: 'notes', id: 'x', u: 1.5, d: '' }] }).status).toBe(400)
    expect(call('pull', { device: 'A' }).status).toBe(400)
  })
})
