#!/usr/bin/env bash
# Einmalige Server-Einrichtung für den automatischen Deploy — ohne SSH, in der
# Hetzner-Konsole als root:
#
#   curl -fsSL https://raw.githubusercontent.com/tarikaydin10/kartei/main/deploy/bootstrap.sh | bash
#
# Mit Caddy-Site (Edge-Caddy, Variante B aus deploy/README.md):
#
#   curl -fsSL https://raw.githubusercontent.com/tarikaydin10/kartei/main/deploy/bootstrap.sh | bash -s -- --caddy
#
# Was es tut:
#   1. Benutzer `deploy` anlegen (ohne Passwort, nur Schlüssel)
#   2. den öffentlichen Deploy-Schlüssel aus deploy/github-deploy.pub eintragen
#   3. /srv/static/kartei/releases anlegen, `deploy` gehört es
#   4. prüfen, dass SSH von außen erreichbar ist (sshd, ufw)
#   5. optional: Caddy-Site ablegen und neu laden
#   6. ausgeben, was in die GitHub-Secrets gehört
#
# Idempotent: mehrfach ausführen schadet nicht. Nichts wird gelöscht.
set -eu

REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/tarikaydin10/kartei/main}"
PUBKEY_URL="${PUBKEY_URL:-$REPO_RAW/deploy/github-deploy.pub}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
ROOT="${DEPLOY_ROOT:-/srv/static/kartei}"
WITH_CADDY=0
[ "${1:-}" = "--caddy" ] && WITH_CADDY=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root ausführen."

# --- 1. Benutzer --------------------------------------------------------
say "1. Benutzer $DEPLOY_USER"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  ok "existiert schon"
else
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  ok "angelegt"
fi
# Kein Passwort, aber auch nicht gesperrt: Ein gesperrtes Konto ('!') lässt
# sshd je nach Konfiguration auch per Schlüssel nicht herein.
usermod -p '*' "$DEPLOY_USER"
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"

# --- 2. Schlüssel -------------------------------------------------------
say "2. Deploy-Schlüssel"
KEY="$(curl -fsSL "$PUBKEY_URL")" || fail "Konnte $PUBKEY_URL nicht laden."
KEY="$(printf '%s' "$KEY" | head -n 1 | tr -d '\r')"
case "$KEY" in
  ssh-ed25519\ *) ;;
  *) fail "deploy/github-deploy.pub ist kein ed25519-Schlüssel." ;;
esac
KEY_BODY="$(printf '%s' "$KEY" | awk '{print $2}')"

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
if grep -qF "$KEY_BODY" "$AUTH"; then
  ok "schon eingetragen"
else
  # `restrict`: keine Weiterleitungen, kein Terminal — Befehle und scp gehen.
  printf 'restrict %s\n' "$KEY" >> "$AUTH"
  ok "eingetragen"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
chmod 600 "$AUTH"

# --- 3. Verzeichnis -----------------------------------------------------
say "3. Verzeichnis $ROOT"
install -d -m 755 "$(dirname "$ROOT")"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT" "$ROOT/releases"
ok "angelegt, gehört $DEPLOY_USER"
if [ -L "$ROOT/current" ]; then
  ok "aktive Release: $(readlink "$ROOT/current")"
else
  warn "noch keine Release — kommt mit dem ersten Deploy"
fi

# --- 4. SSH von außen ---------------------------------------------------
say "4. SSH-Zugang"
PORT=22
if command -v sshd >/dev/null 2>&1; then
  if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null \
    || pgrep -x sshd >/dev/null 2>&1; then
    ok "sshd läuft"
  else
    warn "sshd läuft nicht — starte es"
    systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd
  fi
  CONF="$(sshd -T 2>/dev/null || true)"
  PORT="$(printf '%s\n' "$CONF" | awk '$1 == "port" {print $2; exit}')"
  PORT="${PORT:-22}"
  ok "Port $PORT"
  if printf '%s\n' "$CONF" | grep -q '^pubkeyauthentication no'; then
    warn "PubkeyAuthentication ist aus — in /etc/ssh/sshd_config einschalten"
  fi
  ALLOW="$(printf '%s\n' "$CONF" | awk '$1 == "allowusers" {$1 = ""; print}')"
  if [ -n "$ALLOW" ] && ! printf '%s\n' "$ALLOW" | grep -qw "$DEPLOY_USER"; then
    warn "AllowUsers erlaubt nur:$ALLOW — $DEPLOY_USER dort ergänzen"
  fi
  if printf '%s\n' "$CONF" | grep -q '^passwordauthentication yes'; then
    warn "Passwort-Login ist an. Empfohlen: 'PasswordAuthentication no' in /etc/ssh/sshd_config"
  fi
else
  fail "Kein OpenSSH-Server installiert: apt install -y openssh-server"
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  if ufw status | grep -qE "^($PORT|$PORT/tcp|OpenSSH)[[:space:]]+ALLOW"; then
    ok "ufw lässt Port $PORT durch"
  else
    ufw allow "$PORT/tcp" >/dev/null
    ok "ufw: Port $PORT freigegeben"
  fi
else
  ok "ufw nicht aktiv"
fi
warn "Hetzner Cloud Firewall (falls vorhanden): eingehend TCP $PORT erlauben — GitHub deployt von wechselnden Adressen"

# --- 5. Caddy -----------------------------------------------------------
say "5. Caddy"
if [ -d /srv/edge/conf.d ]; then
  if grep -q '/srv/static' /srv/edge/docker-compose.yml 2>/dev/null; then
    ok "Edge-Caddy sieht /srv/static"
  else
    warn "In /srv/edge/docker-compose.yml fehlt unter caddy.volumes: - /srv/static:/srv/static:ro"
  fi
  if [ "$WITH_CADDY" = 1 ]; then
    curl -fsSL "$REPO_RAW/deploy/kartei.caddy" -o /srv/edge/conf.d/kartei.caddy.new
    mv /srv/edge/conf.d/kartei.caddy.new /srv/edge/conf.d/kartei.caddy
    if docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
      ok "kartei.caddy abgelegt, Caddy neu geladen"
    else
      warn "kartei.caddy abgelegt, Reload fehlgeschlagen — läuft weiter mit alter Konfiguration"
    fi
  elif [ -f /srv/edge/conf.d/kartei.caddy ]; then
    ok "kartei.caddy vorhanden"
  else
    warn "kartei.caddy fehlt — Skript mit --caddy erneut ausführen"
  fi
elif [ -d /etc/caddy ]; then
  ok "Caddy auf dem Host — Site-Datei siehe deploy/README.md, Variante A"
else
  warn "Kein Caddy gefunden — siehe deploy/README.md"
fi

# --- 6. Für GitHub ------------------------------------------------------
IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
FP="$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')"

say "Fertig. In GitHub unter Settings → Secrets and variables → Actions eintragen:"
printf '\n  %-24s %s\n' "DEPLOY_HOST" "${IP:-<IPv4 aus der Hetzner-Konsole>}"
printf '  %-24s %s\n' "DEPLOY_USER" "$DEPLOY_USER"
printf '  %-24s %s\n' "DEPLOY_HOST_FINGERPRINT" "$FP"
[ "$PORT" != 22 ] && printf '  %-24s %s\n' "DEPLOY_PORT" "$PORT"
printf '  %-24s %s\n\n' "DEPLOY_SSH_KEY" "Inhalt der privaten Datei kartei-deploy von deinem Rechner"
