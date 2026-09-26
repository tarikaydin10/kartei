import { describe, expect, it } from 'vitest'
import { annotate, pronounce, unstressedWords } from './pronounce'

describe('pronounce — wann es eine Lautschrift gibt', () => {
  it('braucht bei mehrsilbigen Wörtern eine bekannte Betonung', () => {
    expect(pronounce('молоко')).toBeNull()
    expect(pronounce('молоко́')).toBe('malakó')
  })

  it('kennt die Betonung von Einsilbern und ё ohne Zeichen', () => {
    expect(pronounce('стол')).toBe('stol')
    expect(pronounce('ребёнок')).toBe('ribjónak')
  })

  it('akzeptiert auch den Gravis als Betonungszeichen', () => {
    expect(pronounce('хорошо̀')).toBe('charaschó')
  })

  it('liefert nichts ohne Kyrillisch', () => {
    expect(pronounce('Tisch')).toBeNull()
    expect(pronounce('')).toBeNull()
  })

  it('setzt kein Betonungszeichen bei Einsilbern', () => {
    expect(pronounce('да')).toBe('da')
    expect(pronounce('нет')).toBe('njet')
  })

  it('meldet Wörter ohne Betonung für den Editor', () => {
    expect(unstressedWords('Кни́га на столе')).toEqual(['столе'])
    expect(unstressedWords('Кни́га на столе́.')).toEqual([])
  })
})

describe('pronounce — Vokale', () => {
  it('reduziert unbetontes о zu a (Akanje)', () => {
    expect(pronounce('вода́')).toBe('wadá')
    expect(pronounce('окно́')).toBe('aknó')
    expect(pronounce('я́блоко')).toBe('jáblaka')
  })

  it('reduziert unbetontes е/я nach Konsonant zu i (Ikanje)', () => {
    expect(pronounce('сестра́')).toBe('sistrá')
    expect(pronounce('пятно́')).toBe('pitnó')
    expect(pronounce('де́вять')).toBe('djéwit\'')
  })

  it('lässt е/я am Wortende unreduziert', () => {
    expect(pronounce('вре́мя')).toBe('wrjémja')
    expect(pronounce('мо́ре')).toBe('mórje')
  })

  it('schreibt j am Wortanfang und nach Vokal', () => {
    expect(pronounce('я́ма')).toBe('jáma')
    expect(pronounce('язы́к')).toBe('jisýk')
    expect(pronounce('моя́')).toBe('majá')
  })

  it('macht aus и nach ж/ш/ц ein ы', () => {
    expect(pronounce('жить')).toBe('shyt\'')
    expect(pronounce('маши́на')).toBe('maschýna')
  })

  it('reduziert е nach ж/ш/ц zu y', () => {
    expect(pronounce('жена́')).toBe('shyná')
    expect(pronounce('шесть')).toBe('schest\'')
  })

  it('reduziert а nach ч/щ zu i', () => {
    expect(pronounce('часы́')).toBe('tschissý')
    expect(pronounce('да́ча')).toBe('dátscha')
  })
})

describe('pronounce — Konsonanten', () => {
  it('markiert weiche Konsonanten mit j vor Vokal und \' sonst', () => {
    expect(pronounce('люблю́')).toBe('ljubljú')
    expect(pronounce('день')).toBe('djen\'')
    expect(pronounce('семья́')).toBe('sim\'já')
  })

  it('verschluckt ь nach immer harten oder weichen Konsonanten', () => {
    expect(pronounce('ночь')).toBe('notsch')
    expect(pronounce('мышь')).toBe('mysch')
  })

  it('verhärtet im Auslaut', () => {
    expect(pronounce('хлеб')).toBe('chljep')
    expect(pronounce('друг')).toBe('druk')
    expect(pronounce('го́род')).toBe('górat')
    expect(pronounce('ло́шадь')).toBe('lóschat\'')
  })

  it('gleicht Stimmhaftigkeit im Wortinneren an', () => {
    expect(pronounce('ло́жка')).toBe('lóschka')
    expect(pronounce('вчера́')).toBe('ftschirá')
    expect(pronounce('вокза́л')).toBe('wagsál')
    expect(pronounce('сде́лать')).toBe('sdjélat\'')
  })

  it('schreibt ss zwischen Vokalen und bei Doppel-с', () => {
    expect(pronounce('спаси́бо')).toBe('spassíba')
    expect(pronounce('ру́сский')).toBe('rússkij')
    expect(pronounce('суп')).toBe('sup')
  })

  it('trennt mit ъ', () => {
    expect(pronounce('объясни́ть')).toBe('abjisnít\'')
  })
})

describe('pronounce — Schreibung ungleich Lautung', () => {
  it('lässt stumme Konsonanten weg', () => {
    expect(pronounce('здра́вствуйте')).toBe('sdrástwujtje')
    expect(pronounce('со́лнце')).toBe('sónze')
    expect(pronounce('по́здно')).toBe('pósna')
    expect(pronounce('се́рдце')).toBe('sjérze')
  })

  it('spricht г in -ого/-его als w', () => {
    expect(pronounce('его́')).toBe('jiwó')
    expect(pronounce('но́вого')).toBe('nówawa')
    expect(pronounce('мно́го')).toBe('mnóga')
  })

  it('verschmilzt -ться/-тся zu za', () => {
    expect(pronounce('учи́ться')).toBe('utschíza')
    expect(pronounce('ка́жется')).toBe('káshyza')
  })

  it('verschmilzt сч/жч zu щ und гк zu chk', () => {
    expect(pronounce('сча́стье')).toBe('schschást\'je')
    expect(pronounce('мужчи́на')).toBe('muschschína')
    expect(pronounce('лёгкий')).toBe('ljóchkij')
  })

  it('kennt die echten Ausnahmen, auch ohne Betonungszeichen', () => {
    expect(pronounce('что')).toBe('schto')
    expect(pronounce('коне́чно')).toBe('kanjéschna')
    expect(pronounce('сегодня')).toBe('siwódnja')
    expect(pronounce('пожа́луйста')).toBe('pashálsta')
  })
})

describe('pronounce — Sätze', () => {
  it('behält Satzzeichen und reduziert unbetonte Einsilber', () => {
    expect(pronounce('Я не зна́ю.')).toBe('ja ni snáju.')
    expect(pronounce('Кни́га на столе́.')).toBe('kníga na staljé.')
    expect(pronounce('до свида́ния')).toBe('da swidánija')
  })

  it('gleicht Präpositionen an das nächste Wort an', () => {
    expect(pronounce('в шко́ле')).toBe('f schkólje')
    expect(pronounce('в Гамбу́рге')).toBe('w gambúrgje')
    expect(pronounce('под столо́м')).toBe('pat stalóm')
  })

  it('verhärtet Präpositionen nicht vor Vokal', () => {
    expect(pronounce('в о́фисе')).toBe('w ófissje')
  })

  it('lässt volle Wörter an der Wortgrenze in Ruhe', () => {
    expect(pronounce('Приве́т, как дела́?')).toBe('priwjét, kak dilá?')
    expect(pronounce('нет де́нег')).toBe('njet djénik')
  })

  it('betont einen allein abgefragten Einsilber normal', () => {
    expect(pronounce('не')).toBe('nje')
    expect(pronounce('на')).toBe('na')
  })

  it('verarbeitet Bindestriche und Alternativen', () => {
    expect(pronounce('по-ру́сски')).toBe('pa-rússki')
    expect(pronounce('ты|вы')).toBe('ty|wy')
  })

  it('gibt nichts aus, wenn im Satz eine Betonung fehlt', () => {
    expect(pronounce('Я люблю тебя')).toBeNull()
  })
})

describe('annotate — Lautschrift in Mischtext', () => {
  const pairs = (text: string) => annotate(text).map((a) => [a.text, a.pron])

  it('versieht nur die russischen Stellen mit Lautschrift', () => {
    expect(pairs('m., Pl. лю́ди')).toEqual([
      ['m., Pl. ', null],
      ['лю́ди', 'ljúdi'],
    ])
    expect(pairs('förmlich; du-Form: извини́')).toEqual([
      ['förmlich; du-Form: ', null],
      ['извини́', 'iswiní'],
    ])
  })

  it('trennt an Satzzeichen, hält Wendungen aber zusammen', () => {
    expect(pairs('сказа́ть, говори́ть')).toEqual([
      ['сказа́ть', 'skasát\''],
      [', ', null],
      ['говори́ть', 'gawarít\''],
    ])
    expect(pairs('Präp. + в шко́ле')).toEqual([
      ['Präp. + ', null],
      ['в шко́ле', 'f schkólje'],
    ])
  })

  it('lässt Stellen ohne Betonung ohne Lautschrift', () => {
    expect(pairs('Pl. столы')).toEqual([
      ['Pl. ', null],
      ['столы', null],
    ])
  })

  it('setzt sich wieder zum Eingabetext zusammen', () => {
    for (const s of ['', 'm., dekliniert wie ein Femininum', 'f., Gen. ма́тери (Sg.)', 'дом']) {
      expect(annotate(s).map((a) => a.text).join('')).toBe(s)
    }
  })
})
