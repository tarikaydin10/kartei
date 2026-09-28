/**
 * Datenmodell in drei Ebenen — das ist die zentrale Architekturentscheidung:
 *
 *   Note   = der Inhalt (teilbar, importierbar, aktualisierbar)
 *   Card   = eine Lernrichtung der Note (1 Note -> n Karten)
 *   Review = ein Lernereignis, unveränderlich, append-only
 *
 * Der FSRS-Zustand auf der Card ist abgeleiteter Cache: aus dem Review-Log
 * jederzeit rekonstruierbar (siehe domain/srs.ts). Deshalb ist Sync später
 * konfliktfrei — Reviews werden nur vereinigt, nie gemerged.
 */

export type ID = string

/** Jeder synchronisierbare Datensatz trägt diese Felder. Nie hart löschen. */
export interface SyncMeta {
  id: ID
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type NoteTypeId = 'ru-vocab' | 'concept' | 'basic'

export interface Deck extends SyncMeta {
  name: string
  emoji: string
  noteTypeId: NoteTypeId
  /** 0 = Standard des Nutzers verwenden. */
  newPerDay: number
  sortOrder: number
}

export interface Note extends SyncMeta {
  deckId: ID
  noteTypeId: NoteTypeId
  /** Feldschlüssel je NoteType, siehe domain/notetypes.ts. */
  fields: Record<string, string>
  tags: string[]
}

export interface Card extends SyncMeta {
  noteId: ID
  /** Denormalisiert, damit Deck-Queries ohne Join laufen. */
  deckId: ID
  templateId: string
  suspended: boolean

  /* --- abgeleiteter FSRS-Zustand (Cache) --- */
  due: number
  stability: number
  difficulty: number
  /** 0 New, 1 Learning, 2 Review, 3 Relearning */
  state: 0 | 1 | 2 | 3
  learningSteps: number
  scheduledDays: number
  reps: number
  lapses: number
  lastReview: number | null
}

export type Rating = 1 | 2 | 3 | 4

/** Unveränderlich. Wird nur angefügt, niemals geändert oder gelöscht. */
export interface Review {
  id: ID
  cardId: ID
  noteId: ID
  deckId: ID
  /** Zeitpunkt der Antwort. Sortier- und Sync-Schlüssel. */
  ts: number
  rating: Rating
  durationMs: number
  /** Was getippt wurde — für „was habe ich falsch geschrieben“. */
  typed: string
  verdict: 'correct' | 'near' | 'wrong' | 'manual'
  /** War die Karte vor dieser Antwort neu? Macht „heute neu gelernt“ trivial. */
  wasNew: boolean
  deviceId: string
  /**
   * Übungsantwort (Session wiederholen, schwierige Karten …): zählt als
   * Aktivität, ändert aber die Planung nicht — `replay` überspringt sie.
   * Fehlt bei allen älteren Reviews, dort also immer planungswirksam.
   */
  practice?: boolean
}

/**
 * Sync-Buchführung, nur lokal: Schlüssel `<collection>/<id>`, Wert die Version
 * (`updatedAt`, bei Reviews `ts`), die der Server zuletzt bestätigt hat.
 * Weicht der Datensatz davon ab, ist er zu senden; fehlt ein Review, das hier
 * steht, wurde es zurückgenommen — dann geht ein Löschmarker raus.
 */
export interface SyncedVersion {
  k: string
  u: number
}

export interface StoredSetting {
  key: string
  value: unknown
  updatedAt: number
}

export interface AppSettings {
  /** Reviews pro Tag, die den Streak-Tag zählen lassen. */
  dailyGoal: number
  sessionSize: number
  newPerDay: number
  /** ё und е als gleich behandeln (russische Standardschreibweise). */
  ignoreYo: boolean
  ignoreCase: boolean
  /** Falsch getippt -> richtige Antwort einmal abtippen (motorisches Einprägen). */
  retypeOnWrong: boolean
  haptics: boolean
  sound: boolean
  /** Bildschirmtastatur ЙЦУКЕН statt Systemtastatur für kyrillische Eingabe. */
  cyrillicKeyboard: boolean
  /** Lautschrift zu russischen Wörtern, wo die Betonung feststeht. */
  showPronunciation: boolean
  lastBackupAt: number | null
  deviceId: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  dailyGoal: 20,
  sessionSize: 20,
  newPerDay: 10,
  ignoreYo: true,
  ignoreCase: true,
  retypeOnWrong: true,
  haptics: true,
  sound: false,
  cyrillicKeyboard: true,
  showPronunciation: true,
  lastBackupAt: null,
  deviceId: '',
}
