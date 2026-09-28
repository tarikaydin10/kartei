// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveSyncKeys, generateSyncKey, normalizeSyncKey, seal, unseal } from './crypto'

describe('Sync-Schlüssel', () => {
  it('hat 8 Viererblöcke und besteht die eigene Prüfung', () => {
    const key = generateSyncKey()
    expect(key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    expect(normalizeSyncKey(key)).toBe(key)
  })

  it('verzeiht Schreibweise und Verwechslungen', () => {
    const key = generateSyncKey()
    const sloppy = key.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')
    expect(normalizeSyncKey(sloppy)).toBe(key)
  })

  it('erkennt Tippfehler', () => {
    const key = generateSyncKey()
    const i = 5
    const wrong = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1)
    expect(normalizeSyncKey(wrong)).toBeNull()
    expect(normalizeSyncKey(key.slice(0, -1))).toBeNull()
    expect(normalizeSyncKey('')).toBeNull()
  })
})

describe('deriveSyncKeys', () => {
  it('ergibt auf jedem Gerät denselben Token', async () => {
    const key = generateSyncKey()
    const a = await deriveSyncKeys(key)
    const b = await deriveSyncKeys(key.toLowerCase())
    expect(a.token).toMatch(/^[0-9a-f]{64}$/)
    expect(a.token).toBe(b.token)
    expect((await deriveSyncKeys(generateSyncKey())).token).not.toBe(a.token)
  })
})

describe('seal / unseal', () => {
  it('verschlüsselt hin und zurück', async () => {
    const { key } = await deriveSyncKeys(generateSyncKey())
    const value = { frage: 'Warum?', antwort: 'Darum — mit Umlauten: äöü, und молоко́.' }
    const sealed = await seal(key, 'notes/n1/1', value)
    expect(sealed).not.toContain('Warum')
    expect(await unseal(key, 'notes/n1/1', sealed)).toEqual(value)
  })

  it('lehnt vertauschte Datensätze und fremde Schlüssel ab', async () => {
    const { key } = await deriveSyncKeys(generateSyncKey())
    const sealed = await seal(key, 'notes/n1/1', { x: 1 })
    await expect(unseal(key, 'notes/n2/1', sealed)).rejects.toThrow()
    await expect(unseal(key, 'notes/n1/2', sealed)).rejects.toThrow()
    const other = await deriveSyncKeys(generateSyncKey())
    await expect(unseal(other.key, 'notes/n1/1', sealed)).rejects.toThrow()
  })
})
