import { describe, expect, it } from 'vitest'
import { cardIdFor, stableId } from './id'

describe('stableId', () => {
  it('ist deterministisch', () => {
    expect(stableId('deck', 'arbeit')).toBe(stableId('deck', 'arbeit'))
  })

  it('unterscheidet Eingaben und ihre Aufteilung', () => {
    expect(stableId('deck', 'arbeit')).not.toBe(stableId('deck', 'arbeiT'))
    expect(stableId('ab', 'c')).not.toBe(stableId('a', 'bc'))
  })

  it('hat UUID-Form', () => {
    expect(stableId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('kollidiert nicht bei vielen ähnlichen Eingaben', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50_000; i++) ids.add(stableId('note', 'deck', `wort ${i}`))
    expect(ids.size).toBe(50_000)
  })
})

describe('cardIdFor', () => {
  it('ergibt für dieselbe Notiz und Richtung dieselbe Karte', () => {
    expect(cardIdFor('n1', 'ru2de')).toBe(cardIdFor('n1', 'ru2de'))
    expect(cardIdFor('n1', 'ru2de')).not.toBe(cardIdFor('n1', 'de2ru'))
  })
})
