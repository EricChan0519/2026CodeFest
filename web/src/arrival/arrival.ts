/**
 * 抵達確認與「給別人看」卡片的文字組合（純函式）。
 * 只用站位資料裡有的路線和方向，不暗示車快來了：到站時間不在目前範圍內。
 */
import { metroLineName } from '@/lib/metroLines'
import type { Audience, Lang, Station, StationRoute } from '@/lib/contract'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'

export interface Name {
  zh: string | null
  en: string | null
}

export interface ArrivalTrip {
  station: Name
  route: Name
  headsign: Name
  /** 下車站（直達車規劃算出來的）；沒有就不顯示 */
  alight?: Name
  /** 公車或捷運；沒有就是公車 */
  mode?: 'bus' | 'metro'
  /** 捷運路線代表色 #RRGGBB */
  lineColor?: string
  /** 捷運站內換線：到站卡大標改成「在這裡換線」 */
  changeLine?: boolean
  /** 捷運下車後從哪個出口出站（M3、2） */
  exit?: string
}

export const SPEECH_LANGS: Record<Lang, string> = {
  'zh-TW': 'zh-TW',
  en: 'en-US',
  th: 'th-TH',
  vi: 'vi-VN',
  id: 'id-ID',
  ja: 'ja-JP',
  ko: 'ko-KR',
}
const LANGS = Object.keys(SPEECH_LANGS) as Lang[]
const AUDIENCES: Audience[] = ['elder', 'child', 'visitor']

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')

/** TDX 的 headsign 已帶「往」或 To，句型會再加一次，要先拿掉 */
const stripTo = (text: string | null) => text?.replace(/^(往|to\s+)/i, '').trim() || null

const isNumber = (route: string) => /^\d+$/.test(route)

/** 01 的站名規則：zh-TW 用中文；en 用英文；其他語言用英文＋中文；沒有英文就用中文 */
function displayName(name: Name, lang: Lang): string | null {
  if (lang === 'zh-TW') return name.zh || name.en
  if (lang === 'en' || !name.zh || !name.en || name.zh === name.en) return name.en || name.zh
  return `${name.en} ${name.zh}`
}

const localName = (name: Name, lang: Lang) => (lang === 'zh-TW' ? name.zh || name.en : name.en || name.zh) || null
/** 路線名：捷運線用官方韓文、日文名稱（淡水信義線 → 단수이신이선），其他照 localName */
const routeLocal = (name: Name, lang: Lang) => metroLineName(name.zh, lang) ?? localName(name, lang)

export function buildArrival(trip: ArrivalTrip, lang: Lang, audience: Audience) {
  const s = ARRIVAL_STRINGS[lang]
  const headline = trip.changeLine ? s.changeLine : audience === 'child' ? s.arrivedChild : s.arrived
  const routeBig = routeLocal(trip.route, lang)
  const to = stripTo(localName(trip.headsign, lang))

  let spoken = headline
  if (routeBig) {
    const bus = lang === 'zh-TW' && isNumber(routeBig) ? `${routeBig} 號` : routeBig
    const waitFor = fill(to ? s.waitFor : s.waitForNoDirection, { bus, to: to ?? '' })
    const separator = lang !== 'zh-TW' ? ' ' : headline.endsWith('！') ? '' : '。'
    spoken = `${headline}${separator}${waitFor}`
  }
  const alightName = trip.alight ? displayName(trip.alight, lang) : null
  const getOff = alightName ? fill(s.getOffAt, { stop: alightName }) : null
  if (getOff) spoken += `${lang === 'zh-TW' ? '，' : ', '}${getOff}`

  return {
    headline,
    routeBig,
    /** 路線的英文名和中文不同時（紅3／R3），列出車頭上會看到的中文 */
    routeSub: lang !== 'zh-TW' && routeBig && trip.route.zh && trip.route.zh !== routeBig ? trip.route.zh : null,
    direction: to ? fill(s.direction, { to }) : null,
    station: displayName(trip.station, lang),
    getOff,
    lineColor: trip.lineColor ?? null,
    spoken,
    speechLang: SPEECH_LANGS[lang],
    rate: (audience === 'elder' ? 'slow' : 'normal') as 'slow' | 'normal',
    labels: {
      showOthers: s.showOthers,
      done: s.done,
      hearAgain: s.hearAgain,
      askHint: s.askHint,
      back: s.back,
      readAloud: s.readAloud,
    },
  }
}

/** zh 給旁人看，一律是中文；own 是給手機主人看的翻譯，讓他知道畫面在說什麼 */
export function askCard(trip: ArrivalTrip, lang: Lang) {
  const routeZh = trip.route.zh || trip.route.en
  if (!routeZh) return null

  const zhStrings = ARRIVAL_STRINGS['zh-TW']
  const toZh = stripTo(trip.headsign.zh || trip.headsign.en)
  const busZh = trip.mode === 'metro' ? `捷運${routeZh}` : isNumber(routeZh) ? `${routeZh} 號公車` : `${routeZh} 公車`
  const stationZh = trip.station.zh || trip.station.en

  let own: string | null = null
  if (lang !== 'zh-TW') {
    const s = ARRIVAL_STRINGS[lang]
    const to = stripTo(localName(trip.headsign, lang))
    own = fill(to ? s.ask : s.askNoDirection, { bus: routeLocal(trip.route, lang) ?? routeZh, to: to ?? '' })
    const alightName = trip.alight ? displayName(trip.alight, lang) : null
    if (alightName) own += ` ${fill(s.getOffAt, { stop: alightName })}`
  }
  const alightZh = trip.alight ? trip.alight.zh || trip.alight.en : null

  return {
    zh: fill(toZh ? zhStrings.ask : zhStrings.askNoDirection, { bus: busZh, to: toZh ?? '' }),
    lang: 'zh-TW',
    station: stationZh ? `我在：${stationZh}` : null,
    getOff: alightZh ? `我要在 ${alightZh} 下車` : null,
    own,
  }
}

export interface AskCardView {
  id: 'bus' | 'remind' | 'lost'
  /** 分頁名稱（使用者的語言） */
  tab: string
  /** 給旁人看的中文大字 */
  zh: string
  /** 中文補充（下車站、我在哪） */
  details: string[]
  /** 使用者語言的翻譯；中文介面不需要 */
  own: string | null
}

/**
 * 給別人看的三張卡，一律中文：問是不是這班車、請提醒我下車、我迷路了。
 * 沒有資料的卡不出現（沒有下車站就沒有「提醒我下車」，沒有目的地就沒有「我迷路了」）。
 */
export function askCards(trip: ArrivalTrip, lang: Lang, place?: Name): AskCardView[] {
  const zh = ARRIVAL_STRINGS['zh-TW']
  const s = ARRIVAL_STRINGS[lang]
  const own = (text: string) => (lang === 'zh-TW' ? null : text)
  const cards: AskCardView[] = []

  const bus = askCard(trip, lang)
  if (bus) {
    cards.push({ id: 'bus', tab: s.tabBus, zh: bus.zh, details: [bus.getOff, bus.station].filter((x): x is string => !!x), own: bus.own })
  }
  const alightZh = trip.alight ? trip.alight.zh || trip.alight.en : null
  if (trip.alight && alightZh) {
    cards.push({
      id: 'remind',
      tab: s.tabRemind,
      zh: fill(zh.askRemind, { stop: alightZh }),
      details: [],
      own: own(fill(s.askRemind, { stop: displayName(trip.alight, lang) ?? alightZh })),
    })
  }
  const placeZh = place ? place.zh || place.en : null
  if (place && placeZh) {
    cards.push({
      id: 'lost',
      tab: s.tabLost,
      zh: fill(zh.askLost, { place: placeZh }),
      details: [],
      own: own(fill(s.askLost, { place: displayName(place, lang) ?? placeZh })),
    })
  }
  return cards
}

const QUERY_KEYS = {
  stationZh: ['station', 'zh'],
  stationEn: ['station', 'en'],
  routeZh: ['route', 'zh'],
  routeEn: ['route', 'en'],
  headsignZh: ['headsign', 'zh'],
  headsignEn: ['headsign', 'en'],
  alightZh: ['alight', 'zh'],
  alightEn: ['alight', 'en'],
} as const

/** 給 router.push：導航抵達時帶路線資訊到 /arrived。網址不放座標（ADR-0005） */
export function arrivalLocation(trip: ArrivalTrip, lang: Lang, audience: Audience) {
  const query: Record<string, string> = { lang, audience }
  for (const [key, [part, field]] of Object.entries(QUERY_KEYS)) {
    const value = trip[part]?.[field]
    if (value) query[key] = value
  }
  return { path: '/arrived', query }
}

/**
 * NAV 到站時用：直接丟站點 API 的 Station 和使用者選的那筆 StationRoute。
 *   router.push(arrivalFromStation(station, stationRoute, lang, audience))
 * 只取站名、路線名、方向；座標和 UID 不進網址。
 */
export function arrivalFromStation(
  station: Pick<Station, 'name'>,
  stationRoute: Pick<StationRoute, 'routeName' | 'headsign'>,
  lang: Lang,
  audience: Audience,
  /** 直達車規劃的下車站位（DirectBusOption.alight）；沒有就不帶 */
  alightStation?: Pick<Station, 'name'>,
) {
  return arrivalLocation(
    { station: station.name, route: stationRoute.routeName, headsign: stationRoute.headsign, alight: alightStation?.name },
    lang,
    audience,
  )
}

export function tripFromQuery(query: Record<string, unknown>) {
  const text = (key: string) => (typeof query[key] === 'string' && query[key] ? (query[key] as string) : null)
  const trip: ArrivalTrip = {
    station: { zh: text('stationZh'), en: text('stationEn') },
    route: { zh: text('routeZh') ?? '', en: text('routeEn') },
    headsign: { zh: text('headsignZh'), en: text('headsignEn') },
  }
  if (text('alightZh') || text('alightEn')) trip.alight = { zh: text('alightZh'), en: text('alightEn') }
  return {
    trip,
    lang: LANGS.includes(query.lang as Lang) ? (query.lang as Lang) : ('zh-TW' as Lang),
    audience: AUDIENCES.includes(query.audience as Audience) ? (query.audience as Audience) : ('visitor' as Audience),
  }
}
