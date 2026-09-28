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

## Automatisch bei jedem Push auf `main`

`.github/workflows/deploy.yml` prüft (Typecheck, Lint, Tests), baut und ruft
dann dasselbe `scripts/deploy.mjs` auf. Schlägt ein Test fehl, wird nicht
deployt. Solange die Secrets fehlen, wird nur geprüft und gebaut.

### Einrichten ohne SSH (Hetzner-Konsole)

Wenn du gerade nicht per SSH auf den Server kommst: Alles Nötige holt sich der
Server selbst von GitHub, in der Konsole tippst du genau eine Zeile.

**1. Schlüsselpaar erzeugen** — auf deinem Rechner (PowerShell, Terminal),
bei der Frage nach der Passphrase zweimal Enter:

```bash
ssh-keygen -t ed25519 -C github-deploy-kartei -f kartei-deploy
```

Das ergibt `kartei-deploy` (privat, geheim) und `kartei-deploy.pub`
(öffentlich, darf ins Repo).

**2. Öffentlichen Schlüssel ins Repo** — Inhalt von `kartei-deploy.pub` als
`deploy/github-deploy.pub` auf `main` committen (auf GitHub: *Add file →
Create new file*). Der private Teil kommt nie ins Repo.

**3. In der Hetzner-Konsole** (Cloud Console → Server → `>_` Konsole) als
`root` anmelden und ausführen:

```bash
curl -fsSL https://raw.githubusercontent.com/tarikaydin10/kartei/main/deploy/bootstrap.sh | bash -s -- --caddy
```

`deploy/bootstrap.sh` legt den Benutzer `deploy` an, trägt den Schlüssel ein,
legt `/srv/static/kartei` an, prüft sshd und `ufw`, legt die Caddy-Site ab und
zeigt am Ende an, was in die Secrets gehört — darunter den Fingerabdruck des
Servers (`SHA256:…`). Mehrfach ausführen schadet nicht. Ohne `--caddy` bleibt
die Caddy-Konfiguration unangetastet.

- Kein root-Passwort? Cloud Console → Server → *Rescue* → *Reset root password*.
- Kommen in der Konsole `/`, `|` oder `-` falsch an, ist sie auf US-Tastatur
  gestellt: erst `loadkeys de` tippen.

**4. Secrets auf GitHub** (*Settings → Secrets and variables → Actions*):

| Secret                    | Inhalt                                                 |
| ------------------------- | ------------------------------------------------------ |
| `DEPLOY_HOST`             | IPv4 des Servers (zeigt das Skript bzw. die Konsole)   |
| `DEPLOY_USER`             | `deploy`                                               |
| `DEPLOY_HOST_FINGERPRINT` | `SHA256:…` aus der Ausgabe des Skripts                 |
| `DEPLOY_SSH_KEY`          | kompletter Inhalt der privaten Datei `kartei-deploy`   |

Statt die lange `known_hosts`-Zeile abzutippen, reicht der Fingerabdruck: Der
Workflow holt den Hostschlüssel selbst und bricht ab, wenn er nicht passt.

**5. Hetzner Cloud Firewall** (falls eine am Server hängt): eingehend TCP 22
erlauben. GitHub deployt von wechselnden Adressen; abgesichert ist der Zugang
über den Schlüssel, nicht über die IP.

**6. Testen:** *Actions → Deploy → Run workflow*. Danach deployt jeder Push
und jeder Merge auf `main` von selbst. Die lokale Datei `kartei-deploy` kannst
du löschen, sobald sie als Secret hinterlegt ist.

### Einrichten mit SSH

```bash
# 1. Eigenen Schlüssel nur für GitHub erzeugen (ohne Passphrase)
ssh-keygen -t ed25519 -N '' -C github-deploy-kartei -f kartei-deploy

# 2. Öffentlichen Teil beim deploy-Benutzer auf dem Server eintragen
ssh-copy-id -i kartei-deploy.pub deploy@kartei-vps

# 3. Hostkey des Servers festhalten (echte IP bzw. Hostname, kein Alias)
ssh-keyscan -p 22 <IP-der-CX23>
```

Dann auf GitHub unter **Settings → Secrets and variables → Actions → New
repository secret** anlegen:

| Secret               | Inhalt                                                  |
| -------------------- | ------------------------------------------------------- |
| `DEPLOY_HOST`        | IPv4 der CX23 (der Alias `kartei-vps` gilt nur lokal)   |
| `DEPLOY_USER`        | `deploy`                                                |
| `DEPLOY_SSH_KEY`     | Inhalt von `kartei-deploy` (privater Teil, komplett)    |
| `DEPLOY_KNOWN_HOSTS` | Ausgabe von `ssh-keyscan` aus Schritt 3 (oder `DEPLOY_HOST_FINGERPRINT`, siehe oben) |
| `DEPLOY_PORT`        | optional, nur wenn nicht 22                             |
| `DEPLOY_ROOT`        | optional, nur wenn nicht `/srv/static/kartei`           |

Danach die lokale Datei `kartei-deploy` löschen — sie wird nur noch auf GitHub
gebraucht. Den ersten Lauf ohne neuen Commit startet **Actions → Deploy → Run
workflow**.

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

## Sync-Server

Damit mehrere Geräte denselben Stand haben, läuft neben den statischen Dateien
ein kleiner Dienst: `server/` in diesem Repo. Node ohne Pakete, eine
SQLite-Datei. Er speichert nur verschlüsselte Datensätze; lesen kann er sie
nicht (der Schlüssel verlässt die Geräte nie).

### Einmalig (Variante B, Edge-Caddy)

```bash
# 1. Verzeichnisse: Code für den Build, Daten außerhalb von /srv/static,
#    damit kein Deploy sie anfasst (1000 = Benutzer `node` im Container)
ssh root@kartei-vps 'mkdir -p /srv/kartei-sync /var/lib/kartei-sync \
  && chown deploy:deploy /srv/kartei-sync && chown 1000:1000 /var/lib/kartei-sync'

# 2. Code hochladen (von deinem Rechner aus, im Repo-Verzeichnis)
scp server/Dockerfile server/store.ts server/app.ts server/main.ts deploy@kartei-vps:/srv/kartei-sync/
```

In `/srv/edge/docker-compose.yml` den Dienst ergänzen — im selben Compose wie
der Edge-Caddy, damit er ihn unter `kartei-sync` erreicht:

```yaml
  kartei-sync:
    build: /srv/kartei-sync
    restart: unless-stopped
    environment:
      SYNC_MAX_SPACES: "5"   # wie viele Sync-Schlüssel angenommen werden
    volumes:
      - /var/lib/kartei-sync:/data
```

```bash
cd /srv/edge && docker compose up -d --build kartei-sync

# 3. Site-Datei mit dem /api-Block übernehmen und neu laden
cp deploy/kartei.caddy /srv/edge/conf.d/kartei.caddy
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile

# Prüfen
curl https://kartei.klick-profi.de/api/sync/health   # {"ok":true}
```

Variante A (Caddy auf dem Host): denselben Container mit `-p 127.0.0.1:8788:8788`
starten und in `kartei.caddy` `reverse_proxy 127.0.0.1:8788` eintragen.

### Aktualisieren

Der Server ändert sich selten und wird nicht automatisch deployt:

```bash
scp server/Dockerfile server/store.ts server/app.ts server/main.ts deploy@kartei-vps:/srv/kartei-sync/
ssh root@kartei-vps 'cd /srv/edge && docker compose up -d --build kartei-sync'
```

### Sichern

Alles liegt in `/var/lib/kartei-sync/kartei-sync.db` (plus `-wal`/`-shm`
während des Betriebs). Ein Backup ist optional: Jedes verbundene Gerät hat den
vollständigen Bestand und lädt ihn in einen leeren Server wieder hoch.

`SYNC_MAX_SPACES` begrenzt, wie viele verschiedene Sync-Schlüssel der Server
annimmt — Fremde können ihn so nicht als Speicher missbrauchen. Für dich allein
reicht 1; ein paar mehr erlauben einen Neuanfang mit neuem Schlüssel.

App und API teilen sich die Origin: kein CORS, ein Zertifikat, ein Hostname.
