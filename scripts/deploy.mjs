// Deploy auf den VPS: bauen, packen, hochladen, Symlink umlegen.
//
// Atomar: eine Release wird vollständig entpackt und erst dann eingehängt.
// Es gibt keinen Moment, in dem halb alte und halb neue Dateien ausgeliefert
// werden — bei einer PWA mit gehashten Assets wäre genau das ein kaputter Start.
// Die letzten Releases bleiben liegen; ein Rollback ist ein `ln -sfn`.
//
// Braucht nur `ssh`, `scp` und `tar` — alle drei sind auf Windows 10+ dabei.
// Auf dem Server läuft kein Node, kein npm, keine Registry.
//
// Konfiguration in .env (siehe .env.example):
//   DEPLOY_HOST=vps.example.com
//   DEPLOY_USER=deploy
//   DEPLOY_ROOT=/srv/static/kartei
//   DEPLOY_PORT=22            (optional)
//   DEPLOY_KEEP=3             (optional, wie viele Releases bleiben)
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const {
  DEPLOY_HOST,
  DEPLOY_USER,
  DEPLOY_ROOT = '/srv/static/kartei',
  DEPLOY_PORT = '22',
  DEPLOY_KEEP = '3',
} = process.env

if (!DEPLOY_HOST || !DEPLOY_USER) {
  console.error(
    'Fehlende Zugangsdaten. Setze DEPLOY_HOST und DEPLOY_USER (z. B. in .env).\n' +
      'Vorlage: .env.example',
  )
  process.exit(1)
}

const target = `${DEPLOY_USER}@${DEPLOY_HOST}`
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const remoteTmp = `/tmp/kartei-${stamp}.tar.gz`

// Bewusst ein relativer Pfad im Projektverzeichnis: das GNU-tar aus Git Bash
// hält alles mit einem Doppelpunkt für einen Remote-Host und scheitert an
// `C:\Users\…`. Relative Pfade funktionieren mit beiden tar-Varianten.
const archive = 'kartei-dist.tar.gz'

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })

// Ein einziger Aufruf auf dem Server: entpacken, atomar einhängen, aufräumen.
const remote = `
set -eu
umask 022
ROOT=${shellQuote(DEPLOY_ROOT)}
REL="$ROOT/releases/${stamp}"
mkdir -p "$REL"
tar -xzf ${shellQuote(remoteTmp)} -C "$REL"
rm -f ${shellQuote(remoteTmp)}
ln -sfn "$REL" "$ROOT/.current.new"
mv -Tf "$ROOT/.current.new" "$ROOT/current"
cd "$ROOT/releases"
ls -1t | tail -n +$((${Number(DEPLOY_KEEP) || 3} + 1)) | xargs -r rm -rf
echo "aktiv: $(readlink "$ROOT/current")"
`.trim()

// DEPLOY_DRY_RUN=1 zeigt, was auf dem Server liefe, ohne ihn anzufassen.
if (process.env.DEPLOY_DRY_RUN === '1') {
  console.log(`Ziel: ${target}:${DEPLOY_ROOT} (Port ${DEPLOY_PORT})\n`)
  console.log(remote)
  process.exit(0)
}

try {
  console.log('Packe dist/ …')
  run('tar', ['-czf', archive, '-C', 'dist', '.'])

  console.log(`Lade nach ${target} …`)
  run('scp', ['-P', DEPLOY_PORT, '-q', archive, `${target}:${remoteTmp}`])

  console.log('Hänge Release ein …')
  run('ssh', ['-p', DEPLOY_PORT, target, remote])

  console.log(`✓ Deploy abgeschlossen (${stamp}).`)
} catch (err) {
  console.error('✗ Deploy fehlgeschlagen:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  rmSync(archive, { force: true })
}

/** Einfaches Quoting für die eine Stelle, an der ein Pfad in die Shell geht. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}
