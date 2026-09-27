# CLAUDE.md

Leitfaden für Claude Code (und Menschen) zu diesem Projekt. Produktüberblick und
Befehle stehen in [README.md](README.md).

## Was das ist

**Kartei** — Karteikarten-PWA, offline-first, Single-User. Zuerst russische
Vokabeln mit getippten Antworten, vom Datenmodell her themenoffen.

Leitprinzip: **offline jetzt, sync-ready für später.**

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

Der Build ist ein statisches Bundle — host-agnostisch. Jeder Push auf `main`
wird per GitHub Actions geprüft, gebaut und deployt
(`.github/workflows/deploy.yml` → `scripts/deploy.mjs`, scp + Symlink auf den
VPS, siehe `deploy/README.md`). Was auf `main` landet, ist also live.

## Architekturprinzipien (verbindlich)

1. **Datenzugriff nur über `src/data/repo.ts`.** Components sprechen nie direkt
   mit Dexie. So kann ein Sync-Backend hinter dieselbe Schnittstelle, ohne die
   UI anzufassen.
2. **Drei Ebenen: Note / Card / Review.** Inhalt, Lernrichtung und Lernereignis
   sind getrennt. Reviews sind **append-only und unveränderlich** — die einzige
   Ausnahme ist `undoLastReview`, dokumentiert an Ort und Stelle.
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
   verlässt das Gerät außer durch einen bewussten Export. Das gilt auch fürs
   Vorlesen: nur Stimmen mit `localService` (`lib/speech.ts`).

## Verzeichnisse

```
src/
├─ data/        Dexie-Schema, Repository, Typen, Settings-Hook
├─ domain/      reine Logik: answer, srs, session, streak, notetypes, pronounce
├─ io/          Import/Export: schema, importer, exporter, csv
├─ ui/          Primitives, Sheet, Field, Toast
├─ features/
│  ├─ today/    Dashboard mit Tagesziel und Streak
│  ├─ study/    Lernsession, „Mehr lernen“, Aussprache, ЙЦУКЕН-Tastatur
│  ├─ decks/    Deckliste, Deckdetail, Notiz-Editor
│  ├─ stats/    Heatmap, Fälligkeitsvorschau, Bestand
│  └─ data/     Backup, Import, Einstellungen
└─ lib/         id, date, haptics, sound, speech, cn
scripts/        make-starter.mjs, make-icons.mjs, deploy.mjs
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
- **Neuer Lernmodus** = ein Eintrag in `STUDY_MODES` und ein Fall in
  `pickCards` (`domain/session.ts`). `practice: true` heißt: ins Log, nicht
  in die Planung.
- **Aussprache** (`domain/pronounce.ts`) liefert `null`, wenn bei einem
  mehrsilbigen Wort die Betonung fehlt. Nicht raten — lieber keine Lautschrift.

## Nächster Schritt

**Sync.** Eigener Endpunkt, Push/Pull über `updatedAt`:

- Inhalte (Decks, Notizen): Last-Write-Wins pro Datensatz.
- Fortschritt: Reviews per ID vereinigen (Übungsreviews inklusive), danach
  `replay` — nie mergen.
- Tombstones respektieren, `deviceId` steckt bereits in jedem Review.
