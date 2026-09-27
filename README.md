# Kartei

Karteikarten-PWA, offline-first. Zuerst für russische Vokabeln, vom Datenmodell
her aber für jedes Thema gebaut.

- **Offline.** Alles liegt lokal in IndexedDB. Kein Konto, kein Server, keine
  Netzabhängigkeit.
- **Tippen statt Umdrehen.** Antworten werden geschrieben und zeichenweise
  geprüft — mit ЙЦУКЕН-Bildschirmtastatur für Kyrillisch.
- **FSRS.** Wiederholungsplanung über [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs),
  denselben Algorithmus, den auch Anki verwendet.
- **Mehr als der Tagesplan.** Vorarbeiten, zusätzliche neue Karten, heute
  Gelerntes, schwierige Karten, zufällig gemischt — und am Ende jeder Session
  „Fehler üben“ oder „Nochmal üben“.
- **Aussprache.** Lautschrift in deutscher Lesart (молоко́ → [malakó]) überall,
  wo die Betonung feststeht; Vorlesen, wenn das Gerät eine lokale russische
  Stimme hat.
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

**Automatisch:** Jeder Push auf `main` läuft durch GitHub Actions — Typecheck,
Lint, Tests, Build, dann derselbe Deploy. Die Zugangsdaten liegen als
Repository-Secrets; welche, steht in [deploy/README.md](deploy/README.md).

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
| **Review** | ein Lernereignis, unveränderlich, append-only (`practice` = Übung) |

Der FSRS-Zustand auf der Karte ist ein abgeleiteter Cache und jederzeit aus dem
Review-Log rekonstruierbar (`domain/srs.ts → replay`). Daraus folgen drei
Eigenschaften:

1. Ein aktualisiertes Deck lässt sich importieren, **ohne** den Lernfortschritt
   anzufassen.
2. Ein Deck lässt sich ohne den eigenen Fortschritt weitergeben.
3. Synchronisierung wird konfliktfrei: Reviews werden nur vereinigt, der
   Zustand danach neu berechnet.

## Lernen jenseits des Tagesplans

„Mehr lernen“ (auf „Heute“, im Deck und am Ende jeder Session) bietet zwei
Arten zusätzlicher Runden, Logik in `domain/session.ts → pickCards`:

| Modus                      | Zählt für FSRS | Auswahl                                          |
| -------------------------- | -------------- | ------------------------------------------------ |
| Vorarbeiten                | ja             | die nächsten noch nicht fälligen Karten           |
| Zusätzliche neue Karten    | ja             | neue Karten über das Tageslimit hinaus            |
| Heute gelernte             | nein (Übung)   | alles, was heute schon eine Antwort bekam         |
| Schwierige Karten          | nein (Übung)   | Rückfälle, hohe FSRS-Schwierigkeit, Fehler der letzten 30 Tage |
| Zufällig gemischt          | nein (Übung)   | querbeet aus allen bekannten Karten               |
| Fehler üben / Nochmal üben | nein (Übung)   | Karten der gerade beendeten Session               |

Übungsantworten landen mit `practice: true` im Review-Log: Sie zählen für
Tagesziel, Streak und Heatmap, aber `replay` überspringt sie und die Karte
bleibt unverändert. Sonst würde Pauken am selben Tag die Intervalle aufblähen.

## Aussprache (Russisch)

`domain/pronounce.ts`, rein und unit-getestet. Lautschrift gibt es nur, wo die
Betonung feststeht — Betonungszeichen, `ё` oder ein einziger Vokal. Eine
geratene Aussprache wäre schlimmer als keine; der Editor sagt, wo das Zeichen
fehlt.

Zu sehen ist sie beim Lernen (Wort, Antwort, Beispielsatz), in der Deckliste,
im Editor und in der Grammatik: Dort steht die Lautschrift direkt hinter jeder
russischen Form, etwa „m., Pl. лю́ди [ljúdi]“.

- Betonung als Akzent, Vokalreduktion (unbetontes о → a, е/я → i).
- Weiche Konsonanten (`njet`, `djen'`), Auslautverhärtung (`chljep`),
  Stimmangleichung (`ftschirá`), Präpositionen verschmelzen mit dem Folgewort.
- Stumme Buchstaben (здра́вствуйте → sdrástwujtje), `г` als w in -ого/-его,
  `-ться` → za, echte Ausnahmen wie что → schto, сего́дня → siwódnja.
- Schreibweise nach deutschen Lesegewohnheiten: `sch` = ш, `sh` = ж,
  `schsch` = щ, `tsch` = ч, `z` = ц, `w` = в, `y` = ы, `ch` wie in „Bach“.

Vorlesen läuft über die Web Speech API und **nur mit lokalen Stimmen** —
Online-Stimmen würden den Text an einen Server schicken.

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

Offline-first komplett: Lernen (Tagesplan, Vorarbeiten, Übungsrunden),
Aussprache, Decks, Editor, Statistik, Import/Export, PWA.

Offen: **Synchronisierung** zwischen Geräten. Vorgesehen ist ein schlanker
eigener Endpunkt mit Push/Pull über `updatedAt`. Die Datenschicht ist darauf
vorbereitet; es kommt nichts dazu, was das Schema ändert.
