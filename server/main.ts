/**
 * Kartei-Sync-Server. Ein Prozess, eine SQLite-Datei, keine Abhängigkeiten.
 * Läuft direkt mit Node ≥ 22.18 (TypeScript ohne Build):
 *
 *   node server/main.ts
 *
 * Umgebung:
 *   PORT              Standard 8788
 *   SYNC_DB           Pfad der Datenbank, Standard ./data/kartei-sync.db
 *   SYNC_MAX_SPACES   Wie viele Sync-Schlüssel der Server annimmt, Standard 10.
 *                     Schützt davor, dass Fremde den Speicher füllen.
 */
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SyncStore } from './store.ts'
import { MAX_BODY_BYTES, handle } from './app.ts'

const port = Number(process.env.PORT ?? 8788)
const dbPath = process.env.SYNC_DB ?? './data/kartei-sync.db'
const maxSpaces = Number(process.env.SYNC_MAX_SPACES ?? 10)

mkdirSync(dirname(dbPath), { recursive: true })
const store = new SyncStore(new DatabaseSync(dbPath), maxSpaces)

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  let size = 0
  let aborted = false

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      aborted = true
      send(413, { error: 'Anfrage zu groß.' })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (aborted) return
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const reply = handle(store, req.method ?? 'GET', path, req.headers.authorization, Buffer.concat(chunks).toString('utf8'))
      send(reply.status, reply.body)
    } catch (e) {
      console.error(e)
      send(500, { error: 'Serverfehler.' })
    }
  })
})

server.listen(port, () => console.log(`kartei-sync hört auf :${port}, Datenbank ${dbPath}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
