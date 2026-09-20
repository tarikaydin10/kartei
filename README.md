# Kartei

Karteikarten-PWA, offline-first. Zuerst für russische Vokabeln, vom Datenmodell
her aber für jedes Thema gebaut.

- **Offline.** Alles liegt lokal in IndexedDB. Kein Konto, kein Server, keine
  Netzabhängigkeit.
- **Tippen statt Umdrehen.** Antworten werden geschrieben und zeichenweise
  geprüft — mit ЙЦУКЕН-Bildschirmtastatur für Kyrillisch.
- **FSRS.** Wiederholungsplanung über [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs),
  denselben Algorithmus, den auch Anki verwendet.
- **Import/Export ohne Dubletten.** Ein versioniertes JSON und CSV/TSV mit
  Spaltenzuordnung. Derselbe Import zweimal ausgeführt ändert nichts.
- **Sync-vorbereitet.** UUIDs, `updatedAt` und Tombstones sind von Anfang an da;
  der Lernfortschritt liegt als append-only Event-Log vor.

## Befehle

```bash
npm run dev        # Dev-Server (ohne Service Worker)
npm run build      # tsc -b && vite build -> dist/
npm run preview    # dist/ servieren — hier PWA/Offline testen
npm run typecheck
npm run lint
npm run test
npm run deploy     # build + Upload auf den VPS (Zugangsdaten aus .env)
```

Hilfsskripte:

```bash
node scripts/make-starter.mjs   # public/starter-ru.json neu erzeugen
node scripts/make-icons.mjs     # Icons und apple-touch-icon.png neu erzeugen
```

## Deploy

Vollständige Anleitung in [deploy/README.md](deploy/README.md). Kurz:

```
DEPLOY_HOST=kartei-vps
DEPLOY_USER=deploy
DEPLOY_ROOT=/srv/static/kartei
```

`npm run deploy` baut, packt, lädt per `scp` hoch und legt auf dem Server einen
Symlink um — atomar, mit den letzten drei Releases als Rollback. Auf dem Server
läuft kein Node und kein npm; Caddy liefert die Dateien aus.
`DEPLOY_DRY_RUN=1` zeigt vorher, was passieren würde.

Zwei Dinge sind nicht optional:

- **HTTPS**, sonst gibt es keinen Service Worker und keine Installation auf dem
  Homescreen.
- **Eine eigene Subdomain**, kein Unterordner — `start_url`, `scope` und der
  Service Worker gehen von der Wurzel aus.

Der Lernfortschritt liegt in IndexedDB und ist an die Origin gebunden. Ein
späterer Domainwechsel bedeutet Export und Import von Hand, also die Adresse
einmal richtig wählen.

## Datenmodell in drei Ebenen

| Ebene      | Inhalt                                                       |
| ---------- | ------------------------------------------------------------ |
| **Note**   | der Inhalt (`ru`, `de`, Grammatik, Beispiel) — teilbar        |
| **Card**   | eine Lernrichtung der Note (RU→DE, DE→RU) mit eigenem Verlauf |
| **Review** | ein Lernereignis, unveränderlich, append-only                 |

Der FSRS-Zustand auf der Karte ist ein abgeleiteter Cache und jederzeit aus dem
Review-Log rekonstruierbar (`domain/srs.ts → replay`). Daraus folgen drei
Eigenschaften:

1. Ein aktualisiertes Deck lässt sich importieren, **ohne** den Lernfortschritt
   anzufassen.
2. Ein Deck lässt sich ohne den eigenen Fortschritt weitergeben.
3. Synchronisierung wird konfliktfrei: Reviews werden nur vereinigt, der
   Zustand danach neu berechnet.

## Antwortprüfung (Russisch)

`domain/answer.ts`, rein und unit-getestet:

- Betonungszeichen (U+0300/U+0301) werden entfernt — **nur** diese. `й` ist
  `и` + Breve und `ё` ist `е` + Trema, ein pauschales Strippen aller Combining
  Marks wäre falsch.
- `ё`/`е` gleichwertig (abschaltbar), Groß-/Kleinschreibung egal.
- `ь`, `ъ`, `й` bleiben bedeutungstragend — hier gibt es keine Nachsicht.
- Alternativen mit `|` trennen; Klammerzusätze und ein führender deutscher
  Artikel sind optional; `ae/oe/ue/ss` werden für Umlaute akzeptiert.
- Ein Tippfehler (Levenshtein ≤ 1, bei langen Wörtern ≤ 2) zählt als „knapp
  daneben“ und wird zeichenweise angezeigt.

## Stand

Offline-first komplett: Lernen, Decks, Editor, Statistik, Import/Export, PWA.

Offen: **Synchronisierung** zwischen Geräten. Vorgesehen ist ein schlanker
eigener Endpunkt mit Push/Pull über `updatedAt`. Die Datenschicht ist darauf
vorbereitet; es kommt nichts dazu, was das Schema ändert.
