// Erzeugt public/icon.svg, icon-maskable.svg, favicon.svg und
// apple-touch-icon.png (180×180).
//
// Die PNG wird hier von Hand kodiert, statt eine Bildbibliothek als
// Abhängigkeit aufzunehmen: iOS akzeptiert für das Home-Screen-Icon kein SVG,
// und ein 180er-Quadrat ist wenig Rechnerei.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x0a, 0x0a, 0x0f]
const BACK_CARD = [0x3a, 0x33, 0x5e]
const FRONT_CARD = [0x8b, 0x7c, 0xff]
const INK = [0x0d, 0x0b, 0x1a]

/* ------------------------------------------------------------------ *
 * SVG
 * ------------------------------------------------------------------ */

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** `pad` in Prozent: das maskierbare Icon braucht Luft am Rand. */
function svg(pad) {
  const s = 100 - pad * 2
  const cardW = s * 0.62
  const cardH = s * 0.78
  const cx = pad + s / 2
  const cy = pad + s / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${hex(BG)}"/>
  <g transform="rotate(-8 ${cx} ${cy})">
    <rect x="${cx - cardW / 2 - s * 0.05}" y="${cy - cardH / 2 - s * 0.03}" width="${cardW}" height="${cardH}" rx="${s * 0.09}" fill="${hex(BACK_CARD)}"/>
  </g>
  <g transform="rotate(5 ${cx} ${cy})">
    <rect x="${cx - cardW / 2 + s * 0.04}" y="${cy - cardH / 2 + s * 0.02}" width="${cardW}" height="${cardH}" rx="${s * 0.09}" fill="${hex(FRONT_CARD)}"/>
    <rect x="${cx - cardW / 2 + s * 0.14}" y="${cy - s * 0.1}" width="${cardW * 0.62}" height="${s * 0.055}" rx="${s * 0.028}" fill="${hex(INK)}" opacity="0.85"/>
    <rect x="${cx - cardW / 2 + s * 0.14}" y="${cy + s * 0.01}" width="${cardW * 0.4}" height="${s * 0.055}" rx="${s * 0.028}" fill="${hex(INK)}" opacity="0.55"/>
  </g>
</svg>
`
}

writeFileSync(join(PUBLIC, 'icon.svg'), svg(8), 'utf8')
writeFileSync(join(PUBLIC, 'icon-maskable.svg'), svg(20), 'utf8')
writeFileSync(join(PUBLIC, 'favicon.svg'), svg(4), 'utf8')

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

const SIZE = 180

/** Signierter Abstand zu einem gedrehten, abgerundeten Rechteck (< 0 = innen). */
function roundedRect(px, py, cx, cy, w, h, r, angleDeg) {
  const a = (-angleDeg * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  const y = dx * Math.sin(a) + dy * Math.cos(a)
  const qx = Math.abs(x) - (w / 2 - r)
  const qy = Math.abs(y) - (h / 2 - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r
}

/** Weiche Kante über ein Pixel — sonst sehen die Rundungen gezackt aus. */
function coverage(dist) {
  return Math.max(0, Math.min(1, 0.5 - dist))
}

function blend(base, color, alpha) {
  return base.map((v, i) => Math.round(v * (1 - alpha) + color[i] * alpha))
}

const C = SIZE / 2
const CARD_W = SIZE * 0.44
const CARD_H = SIZE * 0.56
const RADIUS = SIZE * 0.065

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0 // Filter „none“
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5
    const py = y + 0.5
    let rgb = BG

    rgb = blend(
      rgb,
      BACK_CARD,
      coverage(roundedRect(px, py, C - SIZE * 0.045, C - SIZE * 0.025, CARD_W, CARD_H, RADIUS, -8)),
    )
    rgb = blend(
      rgb,
      FRONT_CARD,
      coverage(roundedRect(px, py, C + SIZE * 0.035, C + SIZE * 0.015, CARD_W, CARD_H, RADIUS, 5)),
    )

    // Zwei Textzeilen auf der vorderen Karte.
    const lines = [
      { cy: C - SIZE * 0.045, w: CARD_W * 0.6, alpha: 0.85 },
      { cy: C + SIZE * 0.045, w: CARD_W * 0.38, alpha: 0.55 },
    ]
    for (const l of lines) {
      const d = roundedRect(
        px,
        py,
        C + SIZE * 0.035 - CARD_W * 0.02 + (l.w - CARD_W * 0.6) / 2,
        l.cy,
        l.w,
        SIZE * 0.042,
        SIZE * 0.021,
        5,
      )
      rgb = blend(rgb, INK, coverage(d) * l.alpha)
    }

    raw[o++] = rgb[0]
    raw[o++] = rgb[1]
    raw[o++] = rgb[2]
    raw[o++] = 255
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // Bittiefe
ihdr[9] = 6 // RGBA


const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), png)
console.log(`icon.svg, icon-maskable.svg, favicon.svg, apple-touch-icon.png (${SIZE}px) geschrieben`)
