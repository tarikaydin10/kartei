# CLAUDE.md

Leitfaden für Claude Code (und Menschen) zu diesem Projekt. Produktüberblick und
Befehle stehen in [README.md](README.md).

## Was das ist

**Kartei** — Karteikarten-PWA, offline-first, Single-User. Zuerst russische
Vokabeln mit getippten Antworten, vom Datenmodell her themenoffen.

Leitprinzip: **offline zuerst, Sync als Abgleich im Hintergrund.**

## Tech-Stack

| Bereich    | Wahl                          |
| ---------- | ----------------------------- |
| Sprache    | TypeScript (strict)           |
| Framework  | React 19 + Vite               |
| PWA        | vite-plugin-pwa (Workbox)     |
| Persistenz | Dexie.js (IndexedDB)          |
| Planung    | ts-fsrs (FSRS-6)              |
| UI         | Tailwind CSS v4               |
| Tests      | Vitest                        |
| Lint       | oxlint                        |
| Sync       | `server/`: Node ohne Pakete, `node:sqlite`, Ende-zu-Ende-verschlüsselt |

Der Build ist ein statisches Bundle — host-agnostisch. Der Sync-Server ist
optional und läuft getrennt davon (Container, Deploy von Hand, siehe
`deploy/README.md`). Jeder Push auf `main`
wird per GitHub Actions geprüft, gebaut und deployt
(`.github/workflows/deploy.yml` → `scripts/deploy.mjs`, scp + Symlink auf den
VPS, siehe `deploy/README.md`). Was auf `main` landet, ist also live.

## Architekturprinzipien (verbindlich)

1. **Datenzugriff nur über `src/data/repo.ts`.** Components sprechen nie direkt
   mit Dexie. So kann ein Sync-Backend hinter dieselbe Schnittstelle, ohne die
   UI anzufassen.
2. **Drei Ebenen: Note / Card / Review.** Inhalt, Lernrichtung und Lernereignis
   sind getrennt. Reviews sind **append-only und unveränderlich** — die einzigen
   Ausnahmen sind `undoLastReview` und `amendLastReview` („Ich hatte recht“),
   beide Sekunden nach der Antwort und dokumentiert an Ort und Stelle.
3. **Der FSRS-Zustand auf der Karte ist Cache, nicht Wahrheit.** Er muss
   jederzeit über `replay(createdAt, reviews)` reproduzierbar bleiben. Wer den
   Zustand anfasst, ohne ein Review zu schreiben, bricht den späteren Sync.
   Übungsantworten (`practice: true`) stehen im Log, ändern die Karte nicht und
   werden von `replay` übersprungen — beides muss zusammenpassen.
4. **Sync-ready Records.** Jeder Datensatz trägt `id` (UUID), `createdAt`,
   `updatedAt`, `deletedAt`. **Nie hart löschen.**
5. **Ein Importpfad.** JSON und CSV laufen beide durch `importExportFile`. Der
   Import ist idempotent — dieselbe Datei zweimal ergibt dieselbe Sammlung.
6. **Spielregeln sind reine Funktionen.** Antwortprüfung, Scheduling,
   Warteschlange und Streak liegen in `src/domain/` ohne DB- oder React-Bezug
   und sind unit-getestet. Dort zuerst testen, dann die UI anfassen.
7. **Offline ohne Ausnahme.** Keine Runtime-Abhängigkeit vom Netz. Nichts
   verlässt das Gerät außer durch einen bewussten Export oder den bewusst
   eingerichteten Sync — und der nur verschlüsselt (`lib/crypto.ts`). Das gilt
   auch fürs Vorlesen: nur Stimmen mit `localService` (`lib/speech.ts`).

## Verzeichnisse

```
src/
├─ data/        Dexie-Schema, Repository, Typen, Settings-Hook, Sync-Engine
├─ domain/      reine Logik: answer, srs, session, streak, feedback, notetypes, pronounce, sync
├─ io/          Import/Export: schema, importer, exporter, csv
├─ ui/          Primitives, Sheet, Field, Toast
├─ features/
│  ├─ today/    Dashboard mit Tagesziel und Streak
│  ├─ study/    Lernsession, „Mehr lernen“, Aussprache, ЙЦУКЕН-Tastatur
│  ├─ decks/    Deckliste, Deckdetail, Notiz-Editor
│  ├─ stats/    Heatmap, Fälligkeitsvorschau, Bestand
│  └─ data/     Backup, Import, Geräte-Sync, Einstellungen
└─ lib/         id, crypto, date, haptics, sound, speech, cn
server/         Sync-Server: store (LWW + Sequenz), app (HTTP), main
scripts/        make-starter.mjs, make-icons.mjs, deploy.mjs
public/kartei-format.md   Importformat für Menschen und LLMs (Test hält es aktuell)
```

## Beim Ändern beachten

- **Combining Marks.** In `domain/answer.ts` dürfen nur U+0300/U+0301 entfernt
  werden. `й` = `и` + U+0306, `ё` = `е` + U+0308, deutsche Umlaute ebenso — ein
  pauschales NFD-Strippen zerstört sie. Dafür gibt es Tests; die müssen grün
  bleiben.
- **Dexie-Migrationen additiv.** Neue `version()` anhängen, bestehende nie
  umschreiben.
- **Soft-Deletes filtert die Repository-Schicht in JS**, weil IndexedDB `null`
  nicht indiziert. Nicht versuchen, auf `deletedAt` zu indizieren.
- **Parallele Aufrufe.** Lesen-und-dann-Schreiben gehört in eine Dexie-
  Transaktion (siehe `ensureSeed`) — React StrictMode ruft Effekte doppelt auf.
- **Starterdeck.** Inhalte ändern → `REVISION` in `scripts/make-starter.mjs`
  hochsetzen, sonst erreicht die Korrektur niemanden, der das Deck schon hat.
- **Neuer Kartentyp** = ein Eintrag in `domain/notetypes.ts` (Felder +
  Vorlagen). Kein neuer Code-Pfad nötig; genau dafür ist die Struktur da.
  `pronounce: true` an einem Feld schaltet die Lautschrift dafür ein,
  `pronounce: 'inline'` bei Mischtext (Grammatik) nur für die russischen
  Stellen, jeweils direkt dahinter (`annotate`).
  `grading` an der Vorlage entscheidet über die Bewertung: `typed` wird
  getippt und zeichenweise geprüft (Vokabeln), `self` wird aufgedeckt und
  selbst bewertet (`concept`: Regeln, Architektur, Zusammenhänge).
- **Neuer Lernmodus** = ein Eintrag in `STUDY_MODES` und ein Fall in
  `pickCards` (`domain/session.ts`). `practice: true` heißt: ins Log, nicht
  in die Planung.
- **Aussprache** (`domain/pronounce.ts`) liefert `null`, wenn bei einem
  mehrsilbigen Wort die Betonung fehlt. Nicht raten — lieber keine Lautschrift.
- **Kommentare** (`domain/feedback.ts`) sind der eine trockene Satz unterm
  Ergebnis. Neue Sätze kommen in die passende Liste dort, nicht in die UI.
  Ton: knapp, freundlich-spöttisch, nie belehrend. Bei richtigen Antworten
  nur, wenn es etwas zu sagen gibt (Serie, vorher falsche Karte sitzt) — sonst
  `null`. Abschaltbar über `settings.quips`.

## Sync

Kein Konto: ein **Sync-Schlüssel** je Nutzer, auf jedem Gerät einmal
eingegeben. Daraus entstehen per HKDF der Token für den Server und der
AES-GCM-Schlüssel für die Inhalte. Der Server sieht nur Chiffretext, Sammlung,
ID und Version.

- **Decks, Notizen:** neuer gewinnt, pro Datensatz (`updatedAt`).
- **Karten:** nur `cardMeta` (Deck, Pausiert, Gelöscht) wandert; der
  FSRS-Zustand wird auf jedem Gerät per `replay` aus dem Log berechnet.
- **Reviews:** nach ID vereinigt, nie gemergt. Zurückgenommene reisen als
  Löschmarker.
- **Server:** nimmt nur strikt Neueres an, nummeriert jede Änderung (`seq`);
  abgeholt wird ab Nummer, nicht ab Uhrzeit.
- **Was zu senden ist,** ergibt sich aus der Differenz zur Tabelle `synced`
  (`domain/sync.ts → pendingChanges`). Schreibpfade brauchen keine Buchführung.
- **Nach dem Anwenden** stellt `repairCascades` die Beziehungen wieder her
  (Karte einer gelöschten Notiz, Notiz in gelöschtem Deck).

Beim Ändern:

- **Karten-IDs nur über `cardIdFor(noteId, templateId)`**, nie `newId()` —
  sonst haben zwei Geräte für dieselbe Notiz zwei Karten. Notizen und Decks aus
  Dateien ohne ID bekommen `stableId` (Importer).
- **`Card.updatedAt` stempelt nur Meta-Änderungen.** Wer den FSRS-Zustand
  schreibt (Antwort, Replay), lässt es stehen — sonst überschreibt jede Antwort
  ein „Pausiert“ vom anderen Gerät.
- **Neue synchronisierte Tabelle** = Eintrag in `COLLECTIONS`, Zweig in
  `applyRemote`, Server-`COLLECTIONS`.
- **Einstellungen sind pro Gerät** und werden nicht synchronisiert.
- `src/data/sync.test.ts` spielt zwei Geräte gegen den echten Server-Code.
  Wer am Sync etwas ändert, erweitert dort die Szenarien.
