/**
 * Sync-Regeln. Rein, ohne DB und Netz — die Engine (`data/sync.ts`) liest und
 * schreibt, hier wird nur entschieden.
 *
 * Das Modell:
 *   - Decks und Notizen: der neuere Stand gewinnt, pro Datensatz (`updatedAt`).
 *   - Karten: nur Zuordnung und Status wandern (`cardMeta`), der FSRS-Zustand
 *     wird auf jedem Gerät aus dem Review-Log berechnet (`replay`).
 *   - Reviews: unveränderlich, werden nur vereinigt. Ein zurückgenommenes
 *     Review reist als Löschmarker.
 */
import type { Card, Deck, Note, Review } from '@/data/types'

export type Collection = 'decks' | 'notes' | 'cards' | 'reviews'

/** Reihenfolge beim Anwenden: wovon etwas abhängt, kommt zuerst. */
export const COLLECTIONS: readonly Collection[] = ['decks', 'notes', 'cards', 'reviews']

export function isCollection(v: unknown): v is Collection {
  return typeof v === 'string' && (COLLECTIONS as readonly string[]).includes(v)
}

/** Ein Datensatz zwischen Gerät und Server, Inhalt im Klartext. */
export interface SyncRecord {
  c: Collection
  id: string
  /** Version: `updatedAt`, bei Reviews `ts`, beim Löschmarker der Löschzeitpunkt. */
  u: number
  del?: boolean
  d?: Deck | Note | CardMeta | Review
}

export const syncKey = (c: Collection, id: string): string => `${c}/${id}`

/** Was von einer Karte synchronisiert wird. Der Rest ist Cache. */
export type CardMeta = Pick<
  Card,
  'id' | 'noteId' | 'deckId' | 'templateId' | 'suspended' | 'createdAt' | 'updatedAt' | 'deletedAt'
>

export function cardMeta(card: Card): CardMeta {
  return {
    id: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    templateId: card.templateId,
    suspended: card.suspended,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    deletedAt: card.deletedAt,
  }
}

/**
 * Soll ein Datensatz vom Server den lokalen ersetzen? Ja — außer das Gerät hat
 * eine neuere Fassung, die der Server noch nicht kennt; die geht beim nächsten
 * Senden raus. Gleichstand übernimmt den Server: er ist der Schiedsrichter.
 */
export function remoteApplies(remoteU: number, localU: number | undefined): boolean {
  return localU === undefined || remoteU >= localU
}

export interface LocalSnapshot {
  decks: Deck[]
  notes: Note[]
  cards: Card[]
  reviewIds: string[]
  /** `syncKey` → vom Server bestätigte Version. */
  synced: Map<string, number>
}

export interface Pending {
  /** Decks, Notizen, Karten (als `cardMeta`), deren Stand der Server nicht kennt. */
  records: SyncRecord[]
  /** Reviews, die der Server noch nicht hat — Inhalt lädt die Engine nach. */
  newReviewIds: string[]
  /** Bestätigte Reviews, die lokal fehlen: zurückgenommen — mit ihrer bestätigten Version. */
  deletedReviews: Array<{ id: string; u: number }>
}

/**
 * Was zu senden ist — als Differenz zwischen lokalem Bestand und dem, was der
 * Server bestätigt hat. Keine Buchführung in den Schreibpfaden: Was immer
 * geschrieben wurde (Editor, Import, Lernen, künftiger Code), fällt hier auf.
 */
export function pendingChanges(snap: LocalSnapshot): Pending {
  const records: SyncRecord[] = []
  const push = (c: Collection, id: string, u: number, d: SyncRecord['d']) => {
    if (snap.synced.get(syncKey(c, id)) !== u) records.push({ c, id, u, d })
  }
  for (const d of snap.decks) push('decks', d.id, d.updatedAt, d)
  for (const n of snap.notes) push('notes', n.id, n.updatedAt, n)
  for (const c of snap.cards) push('cards', c.id, c.updatedAt, cardMeta(c))

  const local = new Set(snap.reviewIds)
  const newReviewIds = snap.reviewIds.filter((id) => !snap.synced.has(syncKey('reviews', id)))
  const deletedReviews: Pending['deletedReviews'] = []
  for (const [key, u] of snap.synced) {
    if (!key.startsWith('reviews/')) continue
    const id = key.slice('reviews/'.length)
    if (!local.has(id)) deletedReviews.push({ id, u })
  }
  return { records, newReviewIds, deletedReviews }
}

/**
 * Version eines Löschmarkers. Er muss das Review übertreffen, sonst lehnt der
 * Server ihn ab — auch wenn die Uhr dieses Geräts hinter der des Geräts geht,
 * auf dem das Review entstand.
 */
export function tombstoneVersion(reviewU: number, now: number): number {
  return Math.max(now, reviewU + 1)
}

/**
 * Notbremse: Fehlt plötzlich ein großer Teil der schon synchronisierten
 * Antworten, ist das kein „Zurücknehmen“, sondern ein Datenverlust auf diesem
 * Gerät (geleerter Speicher, halbe Wiederherstellung). Dann nichts löschen —
 * sonst verbreitete der Sync den Verlust auf alle Geräte.
 */
export function looksLikeDataLoss(deleted: number, syncedReviews: number): boolean {
  return deleted > 20 && deleted > syncedReviews * 0.1
}
