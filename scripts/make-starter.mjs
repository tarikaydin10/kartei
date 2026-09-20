// Erzeugt public/starter-ru.json — ein Deck mit russischem Grundwortschatz.
//
// Quelle ist die Liste unten: `ru :: de :: grammatik :: beispielRu :: beispielDe`.
// Ein Apostroph markiert die Betonung und wird zum Combining Acute (U+0301)
// hinter dem betonten Vokal. IDs sind fest vergeben, damit ein erneuter Import
// aktualisiert statt Dubletten anzulegen.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DECK_ID = 'kartei-starter-ru'
const CREATED = Date.parse('2026-01-01T00:00:00Z')

/**
 * Beim Korrigieren von Inhalten hochsetzen. Der Import übernimmt eine Notiz
 * nur, wenn ihr `updatedAt` neuer ist als das lokal gespeicherte — ohne diese
 * Marke käme eine Korrektur nie bei jemandem an, der das Deck schon hat.
 */
const REVISION = Date.parse('2026-09-20T00:00:00Z')

const RAW = `
да :: ja :: :: Да, коне'чно. :: Ja, natürlich.
нет :: nein :: :: Нет, спаси'бо. :: Nein, danke.
приве'т :: hallo :: umgangssprachlich :: Приве'т, как дела'? :: Hallo, wie geht's?
спаси'бо :: danke :: :: Спаси'бо большо'е! :: Vielen Dank!
пожа'луйста :: bitte :: auch als Antwort auf „danke“ :: ::
извини'те :: entschuldigen Sie :: förmlich; du-Form: извини' :: ::
здра'вствуйте :: guten Tag :: förmlich :: Здра'вствуйте, меня' зову'т А'нна. :: Guten Tag, ich heiße Anna.
до свида'ния :: auf Wiedersehen :: :: ::
я :: ich :: :: ::
ты :: du :: :: ::
он :: er :: :: ::
она' :: sie :: Singular :: ::
мы :: wir :: :: ::
вы :: ihr|Sie :: Plural und Höflichkeitsform :: ::
они' :: sie :: Plural :: ::
челове'к :: Mensch :: m., Pl. лю'ди :: ::
же'нщина :: Frau :: f. :: ::
мужчи'на :: Mann :: m., dekliniert wie ein Femininum :: ::
ребёнок :: Kind :: m., Pl. де'ти :: ::
друг :: Freund :: m., Pl. друзья' :: Он мой друг. :: Er ist mein Freund.
семья' :: Familie :: f. :: ::
мать :: Mutter :: f., Gen. ма'тери :: ::
оте'ц :: Vater :: m., Gen. отца' :: ::
сын :: Sohn :: m., Pl. сыновья' :: ::
дочь :: Tochter :: f., Gen. до'чери :: ::
дом :: Haus :: m., Pl. дома' :: Э'то наш дом. :: Das ist unser Haus.
кварти'ра :: Wohnung :: f. :: ::
ко'мната :: Zimmer :: f. :: ::
стол :: Tisch :: m., Gen. стола' :: Кни'га на столе'. :: Das Buch liegt auf dem Tisch.
стул :: Stuhl :: m., Pl. сту'лья :: ::
окно' :: Fenster :: n., Pl. о'кна :: ::
дверь :: Tür :: f. :: ::
кни'га :: Buch :: f. :: Э'то интере'сная кни'га. :: Das ist ein interessantes Buch.
вода' :: Wasser :: f., Akk. во'ду :: Да'йте, пожа'луйста, во'ду. :: Geben Sie mir bitte Wasser.
хлеб :: Brot :: m. :: Я купи'л хлеб. :: Ich habe Brot gekauft.
чай :: Tee :: m. :: Я пью чай ка'ждое у'тро. :: Ich trinke jeden Morgen Tee.
ко'фе :: Kaffee :: m., unveränderlich :: ::
молоко' :: Milch :: n. :: ::
я'блоко :: Apfel :: n., Pl. я'блоки :: ::
мя'со :: Fleisch :: n. :: ::
суп :: Suppe :: m. :: ::
соль :: Salz :: f. :: ::
го'род :: Stadt :: m., Pl. города' :: Мой го'род о'чень краси'вый. :: Meine Stadt ist sehr schön.
у'лица :: Straße :: f. :: ::
маши'на :: Auto :: f. :: Э'то моя' маши'на. :: Das ist mein Auto.
по'езд :: Zug :: m., Pl. поезда' :: ::
рабо'та :: Arbeit :: f. :: Я иду' на рабо'ту. :: Ich gehe zur Arbeit.
шко'ла :: Schule :: f. :: ::
де'ньги :: Geld :: nur Plural, Gen. де'нег :: У меня' нет де'нег. :: Ich habe kein Geld.
вре'мя :: Zeit :: n., Gen. вре'мени :: У меня' нет вре'мени. :: Ich habe keine Zeit.
день :: Tag :: m., Gen. дня :: ::
ночь :: Nacht :: f. :: ::
у'тро :: Morgen :: n. :: ::
ве'чер :: Abend :: m. :: ::
год :: Jahr :: m., Pl. го'ды :: ::
неде'ля :: Woche :: f. :: ::
ме'сяц :: Monat :: m. :: ::
сего'дня :: heute :: :: Сего'дня хоро'шая пого'да. :: Heute ist gutes Wetter.
вчера' :: gestern :: :: ::
за'втра :: morgen :: Zeitangabe, nicht die Tageszeit :: До за'втра! :: Bis morgen!
сейча'с :: jetzt :: :: ::
всегда' :: immer :: :: ::
никогда' :: nie :: doppelte Negation: никогда' не :: ::
ча'сто :: oft :: :: ::
хорошо' :: gut :: Adverb :: Всё хорошо'. :: Alles gut.
пло'хо :: schlecht :: Adverb :: ::
большо'й :: groß :: Adjektiv :: Э'то большо'й го'род. :: Das ist eine große Stadt.
ма'ленький :: klein :: Adjektiv :: ::
но'вый :: neu :: Adjektiv :: ::
ста'рый :: alt :: Adjektiv :: ::
краси'вый :: schön :: Adjektiv :: ::
до'брый :: gütig|gut :: Adjektiv, vom Charakter :: ::
бы'стро :: schnell :: Adverb :: ::
ме'дленно :: langsam :: Adverb :: ::
быть :: sein :: unvollendet; Präsens entfällt meist :: ::
де'лать :: machen|tun :: unv., vollendet: сде'лать :: Что ты де'лаешь? :: Was machst du?
говори'ть :: sprechen|sagen :: unv., vollendet: сказа'ть :: Я говорю' по-ру'сски. :: Ich spreche Russisch.
знать :: wissen|kennen :: unvollendet :: Я не зна'ю. :: Ich weiß nicht.
ду'мать :: denken :: unv., vollendet: поду'мать :: ::
хоте'ть :: wollen|möchten :: unvollendet :: Я хочу' есть. :: Ich möchte essen.
мочь :: können :: unv., vollendet: смочь :: Я не могу'. :: Ich kann nicht.
идти' :: gehen :: unv., zu Fuß, zielgerichtet :: Куда' ты идёшь? :: Wohin gehst du?
е'хать :: fahren :: unv., mit Fahrzeug :: ::
ви'деть :: sehen :: unv., vollendet: уви'деть :: ::
слы'шать :: hören :: unv., vollendet: услы'шать :: ::
чита'ть :: lesen :: unv., vollendet: прочита'ть :: Она' чита'ет кни'гу. :: Sie liest ein Buch.
писа'ть :: schreiben :: unv., vollendet: написа'ть :: Он пи'шет письмо'. :: Er schreibt einen Brief.
рабо'тать :: arbeiten :: unvollendet :: ::
жить :: leben|wohnen :: unvollendet :: Я живу' в Гамбу'рге. :: Ich wohne in Hamburg.
есть :: essen :: unv.; bedeutet auch „es gibt“ :: ::
пить :: trinken :: unv., vollendet: вы'пить :: ::
спать :: schlafen :: unvollendet :: ::
люби'ть :: lieben|mögen :: unvollendet :: Я тебя' люблю'. :: Ich liebe dich.
понима'ть :: verstehen :: unv., vollendet: поня'ть :: Я не понима'ю. :: Ich verstehe nicht.
изуча'ть :: lernen|studieren :: unv., vollendet: изучи'ть :: ::
покупа'ть :: kaufen :: unv., vollendet: купи'ть :: ::
дава'ть :: geben :: unv., vollendet: дать :: ::
брать :: nehmen :: unv., vollendet: взять :: ::
кто :: wer :: :: Кто э'то? :: Wer ist das?
что :: was :: :: Что э'то? :: Was ist das?
где :: wo :: :: Где ты? :: Wo bist du?
когда' :: wann :: :: ::
почему' :: warum :: :: ::
как :: wie :: :: ::
ско'лько :: wie viel|wie viele :: :: Ско'лько э'то сто'ит? :: Wie viel kostet das?
оди'н :: eins :: f. одна', n. одно' :: ::
два :: zwei :: f. две :: ::
три :: drei :: :: ::
четы'ре :: vier :: :: ::
пять :: fünf :: :: ::
шесть :: sechs :: :: ::
семь :: sieben :: :: ::
во'семь :: acht :: :: ::
де'вять :: neun :: :: ::
де'сять :: zehn :: :: ::
`

/** Apostroph -> Combining Acute hinter dem betonten Vokal. */
const stress = (s) => s.replace(/'/g, '́')

const notes = RAW.trim()
  .split('\n')
  .map((line) => line.split('::').map((c) => c.trim()))
  .map(([ru, de, grammatik, beispielRu, beispielDe], i) => ({
    id: `${DECK_ID}-${String(i + 1).padStart(4, '0')}`,
    createdAt: CREATED + i,
    updatedAt: REVISION,
    deletedAt: null,
    deckId: DECK_ID,
    noteTypeId: 'ru-vocab',
    fields: {
      ru: stress(ru ?? ''),
      de: de ?? '',
      grammatik: stress(grammatik ?? ''),
      beispielRu: stress(beispielRu ?? ''),
      beispielDe: beispielDe ?? '',
      notiz: '',
    },
    tags: ['starter'],
  }))

// Wächter: lateinische Buchstaben in einem russischen Feld sind immer ein
// Vertipper (p statt р, e statt е …) und fallen sonst erst beim Lernen auf.
const LATIN = /[A-Za-z]/
for (const n of notes) {
  for (const key of ['ru', 'beispielRu']) {
    if (LATIN.test(n.fields[key])) {
      throw new Error(`Lateinische Buchstaben in ${key} von „${n.fields.ru}“ (${n.fields.de})`)
    }
  }
  if (!n.fields.ru || !n.fields.de) throw new Error(`Leeres Pflichtfeld bei ${n.id}`)
}

const file = {
  format: 'kartei',
  schemaVersion: 1,
  exportedAt: REVISION,
  app: 'kartei-starter',
  includesProgress: false,
  decks: [
    {
      id: DECK_ID,
      createdAt: CREATED,
      updatedAt: REVISION,
      deletedAt: null,
      name: 'Russisch Grundwortschatz',
      emoji: '🇷🇺',
      noteTypeId: 'ru-vocab',
      newPerDay: 0,
      sortOrder: 0,
    },
  ],
  notes,
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'starter-ru.json')
writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`, 'utf8')
console.log(`${notes.length} Notizen -> ${out}`)
