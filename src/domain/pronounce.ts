/**
 * Aussprache als Lautschrift in deutscher Lesart. Reine Funktionen,
 * unit-getestet.
 *
 * Russisch wird nicht gesprochen, wie es geschrieben wird — und fast alles,
 * was abweicht, hängt an der Betonung: unbetontes о klingt wie a (молоко́ ->
 * malakó), unbetontes е/я wie i (сестра́ -> sistrá). Deshalb gilt:
 *
 *   Lautschrift gibt es nur, wo die Betonung feststeht — durch ein
 *   Betonungszeichen (U+0301/U+0300), durch ё oder weil das Wort nur einen
 *   Vokal hat. Sonst `null`. Eine geratene Aussprache wäre schlimmer als keine.
 *
 * Was abgebildet wird: Betonung, Vokalreduktion (Akanje/Ikanje), weiche und
 * harte Konsonanten, Auslautverhärtung und Stimmangleichung, stumme
 * Buchstaben (здра́вствуйте, со́лнце), г als w in -ого/-его, -ться, сч/жч
 * und eine kleine Liste echter Ausnahmen (что, сего́дня, коне́чно …).
 *
 * Schreibweise (angelehnt an Duden und gängige Lehrbücher):
 *   á é í ó ú ý   betonter Vokal
 *   j nach Konsonant vor Vokal, ' sonst   weicher Konsonant (njet, djen')
 *   y = ы   ch = х (wie in „Bach“)   sch = ш   sh = ж (stimmhaft, wie in „Garage“)
 *   schsch = щ (langes, weiches sch)   tsch = ч   z = ц   w = в
 *   s = с/з, ss = stimmloses s zwischen Vokalen
 */

/** Kurzlegende für Tooltips und Einstellungen. */
export const PRONUNCIATION_LEGEND =
  'á = betont · j/\' = weich · y = ы · ch wie in „Bach“ · sch = ш · sh = ж (stimmhaft) · schsch = щ · z = ц · w = в'

const STRESS_MARKS = new Set(['́', '̀'])
const BREVE = '̆'
const DIAERESIS = '̈'

const VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я'])
const IOTATED: Record<string, string> = { я: 'a', е: 'e', ё: 'o', ю: 'u' }
const PLAIN: Record<string, string> = { а: 'a', э: 'e', о: 'o', у: 'u', ы: 'y', и: 'i' }

/** Immer hart: е/и danach klingen wie э/ы. */
const HARD_ONLY = new Set(['ж', 'ш', 'ц'])
/** Immer weich: kein zusätzliches j vor Vokal nötig. */
const SOFT_ONLY = new Set(['ч', 'щ', 'й'])

const VOICED_TO_VOICELESS: Record<string, string> = { б: 'п', в: 'ф', г: 'к', д: 'т', ж: 'ш', з: 'с' }
const VOICELESS_TO_VOICED: Record<string, string> = { п: 'б', ф: 'в', к: 'г', т: 'д', ш: 'ж', с: 'з' }
const VOICELESS = new Set(['п', 'ф', 'к', 'т', 'ш', 'с', 'х', 'ц', 'ч', 'щ'])
/** Stimmhafte Obstruenten, die Stimmhaftigkeit übertragen — в gehört nicht dazu. */
const VOICING_TRIGGERS = new Set(['б', 'г', 'д', 'ж', 'з'])
const OBSTRUENTS = new Set([...Object.keys(VOICED_TO_VOICELESS), ...VOICELESS])

const CONSONANT: Record<string, string> = {
  б: 'b', в: 'w', г: 'g', д: 'd', ж: 'sh', з: 's', й: 'j', к: 'k', л: 'l', м: 'm',
  н: 'n', п: 'p', р: 'r', с: 's', т: 't', ф: 'f', х: 'ch', ц: 'z', ч: 'tsch',
  ш: 'sch', щ: 'schsch',
}

const ACCENT: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý' }

/**
 * Unbetonte Einsilber im Satz: Präpositionen, Partikeln, Konjunktionen.
 * Sie lehnen sich an das Nachbarwort an und werden reduziert (не зна́ю ->
 * ni snáju). Allein abgefragt sind sie normal betont.
 */
const PROCLITICS = new Set([
  'в', 'во', 'на', 'по', 'за', 'до', 'от', 'ото', 'об', 'обо', 'из', 'изо', 'без', 'безо',
  'под', 'подо', 'над', 'надо', 'при', 'про', 'у', 'к', 'ко', 'с', 'со', 'о', 'не', 'ни',
  'и', 'а', 'но',
])
const ENCLITICS = new Set(['же', 'ж', 'ли', 'ль', 'бы', 'б'])

/**
 * Echte Ausnahmen, als Umschrift in regelmäßiger Schreibung — der Rest der
 * Regeln läuft danach ganz normal. Schlüssel ohne Betonung, ё als е.
 */
const IRREGULAR: Record<string, string> = {
  что: 'што',
  чтобы: 'што́бы',
  ничто: 'ништо́',
  нечто: 'не́што',
  конечно: 'коне́шно',
  скучно: 'ску́шно',
  яичница: 'яи́шница',
  сегодня: 'сево́дня',
  сегодняшний: 'сево́дняшний',
  пожалуйста: 'пожа́лста',
  бог: 'бох',
}

/** -ого/-его ohne г-als-w: hier ist das г echt. */
const OGO_KEEPS_G = new Set(['много', 'немного', 'строго', 'дорого', 'недорого', 'убого', 'полого', 'отлого', 'ого'])

/* ------------------------------------------------------------------ *
 * Zerlegung
 * ------------------------------------------------------------------ */

interface Letter {
  ch: string
  stressed: boolean
}

type Token = { kind: 'word'; letters: Letter[] } | { kind: 'other'; text: string }

function isCyrillicLetter(ch: string): boolean {
  return /[Ѐ-ӿ]/.test(ch)
}

/**
 * Text in Wörter und Zwischenraum zerlegen. Gearbeitet wird auf NFD, damit
 * Betonungszeichen als eigene Zeichen sichtbar sind — й (и + Breve) und
 * ё (е + Trema) werden dabei wieder zusammengesetzt, nicht verworfen.
 */
function tokenize(text: string): Token[] {
  const chars = Array.from((text ?? '').normalize('NFD'))
  const tokens: Token[] = []
  let word: Letter[] | null = null
  let other = ''

  const flushOther = () => {
    if (other) tokens.push({ kind: 'other', text: other })
    other = ''
  }
  const flushWord = () => {
    if (word && word.length) tokens.push({ kind: 'word', letters: word })
    word = null
  }

  for (let i = 0; i < chars.length; i++) {
    const base = chars[i]!
    if (/\p{M}/u.test(base)) continue // verwaiste Markierung
    if (!isCyrillicLetter(base)) {
      flushWord()
      other += base
      continue
    }
    flushOther()
    let ch = base.toLocaleLowerCase('ru')
    let stressed = false
    while (i + 1 < chars.length && /\p{M}/u.test(chars[i + 1]!)) {
      const mark = chars[++i]!
      if (STRESS_MARKS.has(mark)) stressed = true
      else if (mark === BREVE && ch === 'и') ch = 'й'
      else if (mark === DIAERESIS && ch === 'е') ch = 'ё'
    }
    word ??= []
    word.push({ ch, stressed })
  }
  flushWord()
  flushOther()
  return tokens
}

const plain = (letters: Letter[]) => letters.map((l) => l.ch).join('')

/* ------------------------------------------------------------------ *
 * Betonung
 * ------------------------------------------------------------------ */

type Role = 'normal' | 'proclitic' | 'enclitic'

/** Indizes der betonten Vokale, `null` = unbekannt. */
function stressOf(letters: Letter[], role: Role): Set<number> | null {
  const vowels = letters.flatMap((l, i) => (VOWELS.has(l.ch) ? [i] : []))
  const marked = vowels.filter((i) => letters[i]!.stressed)
  if (marked.length) return new Set(marked)
  const yo = vowels.filter((i) => letters[i]!.ch === 'ё')
  if (yo.length) return new Set(yo)
  if (vowels.length === 0) return new Set()
  if (vowels.length === 1) return role === 'normal' ? new Set(vowels) : new Set()
  return null
}

/* ------------------------------------------------------------------ *
 * Schreibung -> Lautung
 * ------------------------------------------------------------------ */

function respell(letters: Letter[]): Letter[] {
  const key = plain(letters).replace(/ё/g, 'е')
  const irregular = IRREGULAR[key]
  let out: Letter[] = irregular
    ? ((tokenize(irregular)[0] as { letters: Letter[] } | undefined)?.letters ?? letters)
    : letters.map((l) => ({ ...l }))

  const replace = (pattern: string, by: string) => {
    for (let i = 0; i + pattern.length <= out.length; i++) {
      if (plain(out.slice(i, i + pattern.length)) !== pattern) continue
      const kept = out.slice(i, i + pattern.length)
      const next = Array.from(by).map((ch, k) => ({ ch, stressed: kept[k]?.stressed ?? false }))
      out = [...out.slice(0, i), ...next, ...out.slice(i + pattern.length)]
    }
  }

  // Stumme Konsonanten in Gruppen.
  replace('вств', 'ств') // здра́вствуйте, чу́вство
  replace('стн', 'сн') // ме́стный, изве́стно
  replace('здн', 'зн') // по́здно, пра́здник
  replace('стл', 'сл') // счастли́вый
  replace('лнц', 'нц') // со́лнце
  replace('рдц', 'рц') // се́рдце
  // Verschmelzungen.
  replace('сч', 'щ') // сча́стье
  replace('зч', 'щ') // изво́зчик
  replace('жч', 'щ') // мужчи́на
  replace('тск', 'цк') // де́тский
  replace('дск', 'цк') // городско́й
  replace('гк', 'хк') // лёгкий
  replace('гч', 'хч') // ле́гче

  // -ться/-тся klingt wie -ца.
  const s = plain(out)
  const tsa = s.endsWith('ться') ? 4 : s.endsWith('тся') ? 3 : 0
  if (tsa) out = [...out.slice(0, out.length - tsa), { ch: 'ц', stressed: false }, { ch: 'а', stressed: false }]

  // -ого/-его: г als w (его́, но́вого), außer bei Wörtern mit echtem г.
  const w = plain(out)
  if (/[ое]го$/.test(w) && !OGO_KEEPS_G.has(w.replace(/ё/g, 'е'))) {
    out[out.length - 2] = { ch: 'в', stressed: false }
  }
  return out
}

/** Nächster lautlicher Buchstabe (ь/ъ zählen nicht). */
function nextSound(letters: Letter[], i: number): string | undefined {
  for (let j = i + 1; j < letters.length; j++) {
    const ch = letters[j]!.ch
    if (ch !== 'ь' && ch !== 'ъ') return ch
  }
  return undefined
}

/**
 * Auslautverhärtung und Stimmangleichung von rechts nach links.
 * `following` ist der erste Laut des nächsten Worts im selben Satzteil.
 * Proklitika verhärten nicht — в о́фисе bleibt w, из до́ма bleibt s.
 */
function assimilate(letters: Letter[], following: string | undefined, role: Role): Letter[] {
  const out = letters.map((l) => ({ ...l }))
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i]!.ch
    if (!OBSTRUENTS.has(ch)) continue
    const next = nextSound(out, i) ?? (following && OBSTRUENTS.has(following) ? following : undefined)
    const atEnd = nextSound(out, i) === undefined
    if (next && VOICELESS.has(next)) {
      out[i]!.ch = VOICED_TO_VOICELESS[ch] ?? ch
    } else if (next && VOICING_TRIGGERS.has(next)) {
      out[i]!.ch = VOICELESS_TO_VOICED[ch] ?? ch
    } else if (atEnd && role !== 'proclitic') {
      out[i]!.ch = VOICED_TO_VOICELESS[ch] ?? ch
    }
  }
  return out
}

function transcribeWord(letters: Letter[], stress: Set<number>, role: Role, following: string | undefined): string {
  const l = assimilate(letters, following, role)
  const vowelCount = l.filter((x) => VOWELS.has(x.ch)).length
  const showAccent = vowelCount >= 2
  let out = ''

  const vowel = (base: string, stressed: boolean) => (stressed && showAccent ? ACCENT[base]! : base)

  for (let i = 0; i < l.length; i++) {
    const { ch } = l[i]!
    const prev = l[i - 1]?.ch
    const next = l[i + 1]?.ch
    const stressed = stress.has(i)
    // Proklitika hängen am nächsten Wort — ihr Vokal ist nicht wortfinal.
    const final = i === l.length - 1 && role !== 'proclitic'
    const afterConsonant = prev !== undefined && !VOWELS.has(prev) && prev !== 'ь' && prev !== 'ъ'

    if (ch === 'ь') {
      if (prev && !HARD_ONLY.has(prev) && !SOFT_ONLY.has(prev)) out += "'"
      continue
    }
    if (ch === 'ъ') continue

    if (ch in IOTATED) {
      const base = IOTATED[ch]!
      const reducible = !stressed && !final && (ch === 'я' || ch === 'е')
      if (afterConsonant && HARD_ONLY.has(prev!)) {
        // жена́ -> shyná, шесть -> schest', жёлтый -> shóltyj
        out += reducible ? (ch === 'е' ? 'y' : 'a') : vowel(base, stressed)
      } else if (afterConsonant && SOFT_ONLY.has(prev!)) {
        out += reducible ? 'i' : vowel(base, stressed)
      } else if (afterConsonant) {
        // Weicher Konsonant: нет -> njet, сестра́ -> sistrá
        out += reducible ? 'i' : `j${vowel(base, stressed)}`
      } else {
        // Wortanfang, nach Vokal, nach ь/ъ: я́ма -> jáma, язы́к -> jisýk
        out += `j${reducible ? 'i' : vowel(base, stressed)}`
      }
      continue
    }

    if (ch in PLAIN) {
      let base = PLAIN[ch]!
      if (ch === 'и' && prev && HARD_ONLY.has(prev)) base = 'y' // жить -> shyt'
      if (ch === 'и' && (prev === 'ь' || prev === 'ъ')) {
        out += `j${vowel('i', stressed)}` // воробьи́ -> warab'jí
        continue
      }
      if (!stressed) {
        if (ch === 'о') base = 'a' // молоко́ -> malakó
        if (ch === 'а' && prev && SOFT_ONLY.has(prev) && !final) base = 'i' // часы́ -> tschisý
      }
      out += vowel(base, stressed)
      continue
    }

    if (ch === 'с') {
      // Doppel-с als ein langes ss; zwischen Vokalen ss, damit es stimmlos gelesen wird.
      if (next === 'с') continue
      const between = prev !== undefined && VOWELS.has(prev) && VOWELS.has(nextSound(l, i) ?? '')
      out += prev === 'с' || between ? 'ss' : 's'
      continue
    }

    out += CONSONANT[ch] ?? ch
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Öffentliche Schnittstelle
 * ------------------------------------------------------------------ */

interface Analysed {
  tokens: Token[]
  roles: Role[]
  stresses: Array<Set<number> | null>
  respelled: Letter[][]
}

function analyse(text: string): Analysed {
  const tokens = tokenize(text)
  const words = tokens.filter((t): t is Extract<Token, { kind: 'word' }> => t.kind === 'word')
  const multi = words.length > 1
  const roles: Role[] = []
  const stresses: Array<Set<number> | null> = []
  const respelled: Letter[][] = []
  for (const t of tokens) {
    if (t.kind !== 'word') {
      roles.push('normal')
      stresses.push(new Set())
      respelled.push([])
      continue
    }
    const key = plain(t.letters).replace(/ё/g, 'е')
    const marked = t.letters.some((l) => l.stressed)
    const letters = respell(t.letters)
    const role: Role = !letters.some((l) => VOWELS.has(l.ch))
      ? 'proclitic' // в, к, с: lautlich Teil des nächsten Worts
      : !multi || marked
        ? 'normal'
        : PROCLITICS.has(key)
          ? 'proclitic'
          : ENCLITICS.has(key)
            ? 'enclitic'
            : 'normal'
    roles.push(role)
    respelled.push(letters)
    stresses.push(stressOf(letters, role))
  }
  return { tokens, roles, stresses, respelled }
}

/**
 * Lautschrift für ein Wort, eine Wendung oder einen Satz.
 * `null`, wenn nichts Kyrillisches drin ist oder bei einem mehrsilbigen Wort
 * die Betonung fehlt.
 */
export function pronounce(text: string): string | null {
  const a = analyse(text)
  if (!a.tokens.some((t) => t.kind === 'word')) return null
  if (a.stresses.some((s) => s === null)) return null

  let out = ''
  for (let i = 0; i < a.tokens.length; i++) {
    const t = a.tokens[i]!
    if (t.kind === 'other') {
      out += t.text
      continue
    }
    // Über die Wortgrenze gleicht sich nur ein Proklitikon an (в шко́ле -> f schkólje).
    // Zwischen vollen Wörtern wäre es zwar hörbar (как дела́ -> kag), sähe
    // für Lernende aber wie ein Fehler aus.
    const gap = a.tokens[i + 1]
    const nextWord = a.tokens[i + 2]
    const following =
      a.roles[i] === 'proclitic' && gap?.kind === 'other' && /^\s+$/.test(gap.text) && nextWord?.kind === 'word'
        ? a.respelled[i + 2]![0]?.ch
        : undefined
    out += transcribeWord(a.respelled[i]!, a.stresses[i]!, a.roles[i]!, following)
  }
  return out.trim()
}

/** Mehrsilbige Wörter ohne erkennbare Betonung — für den Hinweis im Editor. */
export function unstressedWords(text: string): string[] {
  const a = analyse(text)
  const out: string[] = []
  a.tokens.forEach((t, i) => {
    if (t.kind === 'word' && a.stresses[i] === null) out.push(plain(t.letters))
  })
  return out
}
