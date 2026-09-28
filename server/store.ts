/**
 * Speicher des Sync-Servers. Er kennt keine Decks und keine Karten — nur
 * verschlüsselte Datensätze mit Sammlung, ID und Version. Entschieden wird
 * hier genau eine Sache: welcher Stand eines Datensatzes gilt.
 *
 *   - Ein Datensatz ersetzt den Bestand nur mit **strikt größerer** Version.
 *     Gleichstand lässt den Bestand stehen: dieselbe Datei auf zwei Geräten
 *     importiert ergibt gleiche Versionen, und ein erneut gesendetes Review
 *     darf seinen eigenen Löschmarker nicht überschreiben.
 *   - Jede angenommene Änderung bekommt eine fortlaufende Nummer (`seq`) je
 *     Raum. Abgeholt wird ab einer Nummer, nicht ab einer Uhrzeit — Geräteuhren
 *     dürfen falsch gehen, ohne dass Änderungen verloren gehen.
 */
import type { DatabaseSync } from 'node:sqlite'

export const COLLECTIONS = ['decks', 'notes', 'cards', 'reviews'] as const
export type Collection = (typeof COLLECTIONS)[number]

/** Ein Datensatz auf dem Draht. `d` ist Chiffretext, der Server liest ihn nie. */
export interface WireRecord {
  c: Collection
  id: string
  u: number
  del?: true
  d?: string
}

export interface PullResult {
  records: WireRecord[]
  cursor: number
  more: boolean
  /** Gibt es unter diesem Schlüssel schon Daten? Für die Rückfrage beim Verbinden. */
  exists: boolean
}

interface Row {
  c: Collection
  id: string
  u: number
  del: number
  d: string | null
  seq: number
}

export class SpaceLimitError extends Error {}

export class SyncStore {
  private readonly db: DatabaseSync
  private readonly maxSpaces: number

  constructor(db: DatabaseSync, maxSpaces: number) {
    this.db = db
    this.maxSpaces = maxSpaces
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS spaces (
        id      TEXT PRIMARY KEY,
        created INTEGER NOT NULL,
        seq     INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS records (
        space TEXT    NOT NULL,
        c     TEXT    NOT NULL,
        id    TEXT    NOT NULL,
        u     INTEGER NOT NULL,
        del   INTEGER NOT NULL DEFAULT 0,
        d     TEXT,
        dev   TEXT    NOT NULL,
        seq   INTEGER NOT NULL,
        PRIMARY KEY (space, c, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS records_by_seq ON records (space, seq);
    `)
  }

  /** Nimmt an, was neuer ist; liefert für den Rest den geltenden Stand zurück. */
  push(space: string, device: string, records: WireRecord[], now = Date.now()): { rejected: WireRecord[] } {
    const rejected: WireRecord[] = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      let seq = this.ensureSpace(space, now)
      const get = this.db.prepare('SELECT c, id, u, del, d, seq FROM records WHERE space = ? AND c = ? AND id = ?')
      const put = this.db.prepare(`
        INSERT INTO records (space, c, id, u, del, d, dev, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (space, c, id) DO UPDATE SET
          u = excluded.u, del = excluded.del, d = excluded.d, dev = excluded.dev, seq = excluded.seq
      `)
      for (const r of records) {
        const existing = get.get(space, r.c, r.id) as Row | undefined
        if (existing && r.u <= existing.u) {
          rejected.push(toWire(existing))
          continue
        }
        seq++
        put.run(space, r.c, r.id, r.u, r.del ? 1 : 0, r.del ? null : (r.d ?? null), device, seq)
      }
      this.db.prepare('UPDATE spaces SET seq = ? WHERE id = ?').run(seq, space)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { rejected }
  }

  /** Änderungen anderer Geräte seit `since`, in der Reihenfolge, in der sie ankamen. */
  pull(space: string, device: string, since: number, limit: number): PullResult {
    const head = this.db.prepare('SELECT seq FROM spaces WHERE id = ?').get(space) as { seq: number } | undefined
    if (!head) return { records: [], cursor: 0, more: false, exists: false }
    const rows = this.db
      .prepare(
        'SELECT c, id, u, del, d, seq FROM records WHERE space = ? AND seq > ? AND dev != ? ORDER BY seq LIMIT ?',
      )
      .all(space, since, device, limit) as unknown as Row[]
    const more = rows.length === limit
    return {
      records: rows.map(toWire),
      // Ohne weitere Seite gilt der Kopf des Raums — eigene Änderungen, die
      // hier nicht mitkommen, sind damit ebenfalls abgehakt.
      cursor: more ? rows[rows.length - 1]!.seq : head.seq,
      more,
      exists: true,
    }
  }

  private ensureSpace(space: string, now: number): number {
    const row = this.db.prepare('SELECT seq FROM spaces WHERE id = ?').get(space) as { seq: number } | undefined
    if (row) return row.seq
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM spaces').get() as { n: number }
    if (n >= this.maxSpaces) throw new SpaceLimitError('Keine weiteren Sync-Räume erlaubt.')
    this.db.prepare('INSERT INTO spaces (id, created, seq) VALUES (?, ?, 0)').run(space, now)
    return 0
  }
}

function toWire(row: Row): WireRecord {
  return row.del ? { c: row.c, id: row.id, u: row.u, del: true } : { c: row.c, id: row.id, u: row.u, d: row.d ?? '' }
}
