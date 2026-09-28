# Kartei – Importformat

Kartei ist eine Karteikarten-App mit Wiederholungsplanung (FSRS). Ein Deck wird
als **eine JSON-Datei** importiert (Tab „Daten“ → „Daten importieren“). Diese
Beschreibung reicht, um aus beliebigem Material ein Deck zu erzeugen. Kartentyp,
Fragen und Umfang wählst du selbst passend zum Material.

## Datei

```json
{
  "format": "kartei",
  "schemaVersion": 1,
  "decks": [{ "name": "Arbeit – Architektur", "emoji": "🏗️", "noteTypeId": "concept" }],
  "notes": [
    {
      "noteTypeId": "concept",
      "fields": { "frage": "…", "antwort": "…", "erklaerung": "…", "quelle": "…" },
      "tags": ["architektur"]
    }
  ]
}
```

- Nur das JSON ausgeben, ohne Text davor oder danach.
- Ein Deck hat genau **einen** Kartentyp. Alle Notizen darin tragen dieselbe `noteTypeId`.
- Mehrere Decks in einer Datei: jedem Deck eine `id` geben (beliebiger eindeutiger
  Text) und jede Notiz per `deckId` zuordnen. Bei nur einem Deck beides weglassen.
- `tags`: optional, kleingeschrieben, ohne Leerzeichen.
- Nicht erzeugen: `createdAt`, `updatedAt`, `cards`, `reviews`. Der Lernfortschritt
  entsteht in der App.
- Leere optionale Felder dürfen fehlen oder `""` sein.

## Kartentypen

| `noteTypeId` | Bewertung                        | Wofür                                                        |
| ------------ | -------------------------------- | ------------------------------------------------------------ |
| `concept`    | aufdecken, **selbst** bewerten   | Regeln, Konzepte, Begründungen – alles, was man in eigenen Worten beantwortet |
| `basic`      | **getippt**, zeichengenau geprüft | kurze, eindeutige Antworten: Begriff, Name, Zahl, Pfad, Befehl |
| `ru-vocab`   | **getippt**, beide Richtungen    | russische Vokabeln                                           |

Faustregel: Passt die richtige Antwort in wenige Wörter und gibt es genau eine
Schreibweise, nimm `basic`. Sonst `concept`.

### `concept` – Frage und Antwort in eigenen Worten

| Feld         | Pflicht | Inhalt                                                         |
| ------------ | ------- | -------------------------------------------------------------- |
| `frage`      | ja      | Die Frage. Identifiziert die Karte im Deck.                    |
| `antwort`    | ja      | Der Kern in 1–2 Sätzen, an dem man die eigene Antwort misst.   |
| `erklaerung` | nein    | Begründung, Beispiel, Ausnahme. Erscheint nach dem Aufdecken.  |
| `quelle`     | nein    | Wo es steht (Dokument, Abschnitt, ADR-Nummer).                 |

Die Antwort wird nicht automatisch geprüft. Der Lernende vergleicht selbst und
bewertet mit „Nicht gewusst / Mühsam / Gewusst“.

### `basic` – Vorder- und Rückseite, getippt

| Feld     | Pflicht | Inhalt                                      |
| -------- | ------- | ------------------------------------------- |
| `vorne`  | ja      | Die Frage. Identifiziert die Karte im Deck. |
| `hinten` | ja      | Die Antwort, die getippt wird.              |
| `notiz`  | nein    | Kontext, erscheint nach dem Antworten.      |

Die Prüfung von `hinten`:
- Groß-/Kleinschreibung ist egal, ein führender Artikel (der, die, das, ein …) auch.
- Text in Klammern ist optional: `(nur) über repo.ts`.
- Mehrere gleichwertige Antworten trennt `|`: `Repository|Repo`.
- Bei längeren Antworten werden ein bis zwei Tippfehler als „knapp“ gewertet.
- Deshalb gilt: kurz halten, keine ganzen Sätze.

### `ru-vocab` – Russische Vokabel

| Feld         | Pflicht | Inhalt                                                             |
| ------------ | ------- | ------------------------------------------------------------------ |
| `ru`         | ja      | Russisches Wort mit Betonungszeichen (U+0301 hinter dem betonten Vokal): `молоко́`. Identifiziert die Karte. |
| `de`         | ja      | Deutsche Übersetzung, Alternativen mit `\|` getrennt: `Tisch\|Tafel` |
| `grammatik`  | nein    | Genus, Plural, Aspektpartner: `m., Pl. столы́`                      |
| `beispielRu` | nein    | Beispielsatz auf Russisch, mit Betonungszeichen                    |
| `beispielDe` | nein    | Übersetzung des Beispielsatzes                                     |
| `notiz`      | nein    | Freie Notiz                                                        |

Abgefragt wird in beide Richtungen, getippt. Betonungszeichen muss beim Tippen
niemand setzen. Sie steuern aber die Lautschrift, also bei mehrsilbigen Wörtern
immer setzen.

## Gute Karten

- Eine Karte, ein Gedanke. Lieber drei kleine Karten als eine große.
- Die Frage lässt genau eine richtige Antwort zu und versteht sich ohne die anderen Karten.
- Verständnis vor Auswendiglernen: Warum-, Wann- und Was-passiert-wenn-Fragen
  sowie Szenarien („Ich will X ändern – was muss ich beachten?“) statt nur Definitionen.
- Nichts erfinden, was nicht im Material steht.

## Erneut importieren

Der Import ist idempotent. Dieselbe Datei zweimal ergibt keine Dubletten.

- Das Deck wird über seinen Namen wiedererkannt.
- Eine Karte wird über ihre Frage wiedererkannt: `frage`, `vorne` bzw. `ru`.
  Geänderte übrige Felder aktualisieren die Karte, der Lernfortschritt bleibt.
- Eine umformulierte Frage ergibt eine neue Karte.

Zum Erweitern eines Decks also denselben Decknamen verwenden und bestehende
Fragen wörtlich stehen lassen.
