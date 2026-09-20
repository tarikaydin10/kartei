# Deploy auf den VPS

Kartei ist ein statisches Bundle. Auf dem Server läuft **kein Prozess dafür** —
Caddy liefert die Dateien aus, ein Deploy ist ein Symlink-Wechsel.

```
/srv/static/kartei/releases/2026-09-20T02-30-00/   ← eine Release
/srv/static/kartei/current -> releases/…           ← was ausgeliefert wird
```

Der Wechsel ist atomar: erst vollständig entpacken, dann einhängen. Rollback ist
ein `ln -sfn` auf eine ältere Release.

---

## Einmalig auf dem Server

Du hast auf der CX23 zwei mögliche Formen — nimm die, in der rjadom läuft.

### Variante B · Edge-Caddy (mehrere Systeme auf der Maschine)

Das ist das Setup aus `rjadom/deploy/edge/`. Kartei braucht dort **keinen
Container**, nur ein Verzeichnis und eine Site-Datei.

```bash
# 1. Verzeichnis anlegen (deploy = der SSH-Benutzer, der hochlädt)
mkdir -p /srv/static/kartei/releases
chown -R deploy:deploy /srv/static
```

```bash
# 2. Dem Edge-Caddy das Verzeichnis zeigen — einmalig, danach nie wieder.
#    In /srv/edge/docker-compose.yml unter caddy.volumes ergänzen:
#      - /srv/static:/srv/static:ro
cd /srv/edge && docker compose up -d
```

`/srv/static` statt `/srv/static/kartei` zu mounten ist Absicht: die nächste
statische Seite braucht dann keinen Compose-Eingriff mehr, nur noch eine
`.caddy`-Datei.

```bash
# 3. Site-Datei ablegen (Domain steht schon drin) und Caddy neu laden
cp deploy/kartei.caddy /srv/edge/conf.d/kartei.caddy
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

Ein Syntaxfehler lässt den Reload fehlschlagen und die laufende Konfiguration
unangetastet — es kann dabei nichts umfallen.

### Variante A · Caddy direkt auf dem Host

```bash
mkdir -p /srv/static/kartei/releases
chown -R deploy:deploy /srv/static

cp deploy/kartei.caddy /etc/caddy/conf.d/kartei.caddy
systemctl reload caddy
```

Falls `/etc/caddy/Caddyfile` noch kein `import conf.d/*.caddy` hat, die Zeile
oben ergänzen.

### DNS bei ALL-INKL

`klick-profi.de` liegt bei ALL-INKL, kartei läuft auf der Hetzner CX23. Zu
verknüpfen ist also genau eine Sache: ein `A`-Record für die Subdomain, der auf
den VPS zeigt. Der Rest der Domain — Website, Mail, alle anderen Records —
bleibt unberührt.

Im **KAS** unter `Domain` → `klick-profi.de` → `DNS-Einstellungen`:

| Name     | Typ    | Wert                     |
| -------- | ------ | ------------------------ |
| `kartei` | `A`    | IPv4 der CX23            |
| `kartei` | `AAAA` | IPv6 der CX23 (optional) |

**Nicht** unter „Subdomain anlegen" eine Subdomain auf dem ALL-INKL-Webspace
erzeugen. Das legt einen eigenen A-Record auf den KAS-Server an, der mit dem
hier konkurriert. Es braucht nur den DNS-Eintrag.

Prüfen, sobald es propagiert ist (Minuten bis ~1 h):

```bash
nslookup kartei.klick-profi.de
```

Zwei Dinge, die sonst das Zertifikat verhindern:

- **Port 80 und 443 müssen von außen erreichbar sein.** Caddy holt das
  Zertifikat über eine HTTP-Anfrage auf Port 80. Hetzner-Firewall und `ufw`
  entsprechend offen.
- **CAA-Record prüfen.** Falls auf `klick-profi.de` ein CAA-Eintrag liegt, der
  nur eine bestimmte CA erlaubt, scheitert Let's Encrypt:

```bash
dig CAA klick-profi.de +short
```

Kommt nichts zurück, ist alles in Ordnung. Kommt etwas zurück, muss
`letsencrypt.org` darin vorkommen.

---

## Lokal einrichten

SSH-Key auf den Server bringen, falls noch nicht geschehen:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@kartei-vps
```

Dann `.env` anlegen:

```bash
cp .env.example .env
```

```
DEPLOY_HOST=kartei-vps
DEPLOY_USER=deploy
DEPLOY_ROOT=/srv/static/kartei
```

---

## Deployen

```bash
npm run deploy
```

Baut, packt, lädt hoch, hängt die Release ein, räumt alte auf. Braucht nur
`ssh`, `scp` und `tar` — alles auf Windows 10+ dabei. Auf dem Server läuft
weder Node noch npm.

## Rollback

```bash
ssh deploy@kartei-vps 'ls -1t /srv/static/kartei/releases'
ssh deploy@kartei-vps 'ln -sfn /srv/static/kartei/releases/<STAMP> /srv/static/kartei/.n \
  && mv -Tf /srv/static/kartei/.n /srv/static/kartei/current'
```

Kein Neustart nötig, Caddy folgt dem Symlink pro Anfrage.

---

## Warum die Adresse jetzt feststehen sollte

Der Lernfortschritt liegt in IndexedDB und ist **an die Origin gebunden**
(Schema + Host + Port). Ein späterer Wechsel der Domain bedeutet nicht
Datenverlust, aber Export und Import von Hand. Einmal richtig wählen ist
billiger.

Aus demselben Grund eine **eigene Subdomain, kein Unterordner**: `start_url`,
`scope` und der Service Worker gehen von der Wurzel aus.

## Wenn der Sync-Server kommt

In `deploy/kartei.caddy` steckt der Block dafür schon auskommentiert. Dann:

- ein Node-Prozess (systemd oder Container am `edge`-Netz) auf `127.0.0.1:8788`
- `handle /api/*` in der Site-Datei aktivieren, **vor** dem catch-all `handle`
- die Daten außerhalb von `/srv/static/kartei` ablegen, damit ein Deploy sie
  nicht anfassen kann — wie `/var/lib/ryadom` bei rjadom

Die URL bleibt dieselbe. App und API teilen sich die Origin: kein CORS, ein
Zertifikat, ein Hostname.
