/**
 * 導航頁畫面上和語音的句子（純函式）：依使用者選的語言，從 i18n/nav.ts 組出來。
 * 站名一律帶中文（要對得上路邊站牌）；非中文介面前面加英文站名。
 */
import type { Lang, ManeuverKind } from '@/lib/contract'
import { NAV_STRINGS, type NavStrings } from '@/i18n/nav'
import type { BusPlan } from '@/lib/transferBus'
import type { Cue } from './announcer'
import type { DirectionKey } from './arrow'
import type { NavView } from './machine'

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))

/** 箭頭畫面的剩餘距離：10 公尺內說「快到了」；100 公尺以上取到 10，以下取到 5 */
export function distanceLabel(m: number | null, lang: Lang): string {
  const s = NAV_STRINGS[lang]
  if (m === null) return '—'
  if (m < 10) return s.almostThere
  const r = m >= 100 ? Math.round(m / 10) * 10 : Math.round(m / 5) * 5
  return fill(s.meters, { n: r })
}

/** 搜尋結果、公車選項的距離：取到 10 公尺，1 公里以上用公里 */
export function placeDistance(m: number, lang: Lang): string {
  const s = NAV_STRINGS[lang]
  if (m < 1000) return fill(s.meters, { n: Math.max(10, Math.round(m / 10) * 10) })
  return fill(s.km, { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) })
}

const TURN_KEY: Partial<Record<ManeuverKind, keyof NavStrings>> = {
  left: 'turnLeft',
  right: 'turnRight',
  slight_left: 'turnSlightLeft',
  slight_right: 'turnSlightRight',
  uturn: 'turnUturn',
  stairs: 'turnStairs',
}
const turnWord = (kind: ManeuverKind | undefined, s: NavStrings) => s[(kind && TURN_KEY[kind]) || 'turnGeneric']
const turnAhead = (kind: ManeuverKind | undefined, s: NavStrings) => fill(s.turnAhead, { turn: turnWord(kind, s) })

const DIR_KEY: Record<DirectionKey, keyof NavStrings> = {
  straight: 'dirStraight',
  bear_left: 'dirBearLeft',
  bear_right: 'dirBearRight',
  left: 'dirLeft',
  right: 'dirRight',
  turn_around: 'dirTurnAround',
}

/** 語音提示（也寫進除錯紀錄） */
export function cueText(c: Cue, lang: Lang): string {
  const s = NAV_STRINGS[lang]
  switch (c.key) {
    case 'start':
      return s.cueStart
    case 'turn_ahead':
      return turnAhead(c.turn, s)
    case 'turn_around':
      return s.dirTurnAround
    case 'off_route':
      return s.cueOffRoute
    case 'weak_signal':
      return s.cueWeak
    case 'arrived':
      return s.arrived
  }
}

/** 箭頭下方的大字 */
export function bigText(v: NavView, lang: Lang): string {
  const s = NAV_STRINGS[lang]
  switch (v.state) {
    case 'locating':
      return s.locating
    case 'routing':
      return s.routing
    case 'weak_signal':
      return s.weakSignal
    case 'rerouting':
      return s.rerouting
    case 'arrived':
      return s.arrived
    case 'failed':
      return v.failReason === 'location_denied' ? s.noPermission : v.failReason === 'route_failed' ? s.noRoute : s.locateFailed
    default:
      return v.headingLost ? s.noHeading : distanceLabel(v.distanceM, lang)
  }
}

/** 大字下面的一句話 */
export function sentence(v: NavView, lang: Lang, atBusStop: boolean): string {
  const s = NAV_STRINGS[lang]
  if (v.headingLost && (v.state === 'navigating' || v.state === 'back_to_route')) return s.figure8
  switch (v.state) {
    case 'weak_signal':
      return s.goOpen
    case 'rerouting':
      return s.findingRoute
    case 'back_to_route':
      return s.backToRoute
    case 'arrived':
      return atBusStop ? s.waitBusHere : s.arrivedDest
    case 'failed':
      return s.tryAgain
    case 'navigating': {
      const t = v.nextTurn
      if (t && t.kind !== 'arrive' && t.distanceM <= 30) return turnAhead(t.kind, s)
      return v.direction ? s[DIR_KEY[v.direction]] : ''
    }
    default:
      return ''
  }
}

interface Named {
  zh: string | null
  en: string | null
}

/** 站名：中文介面只用中文；其他語言「英文 中文」，對得上站牌 */
export function stopName(name: Named, lang: Lang): string {
  const zh = name.zh || name.en || ''
  if (lang === 'zh-TW' || !name.en || name.en === zh) return zh
  return `${name.en} ${zh}`
}

/** 路線名：非中文介面用英文路線名（R3）；數字路線一樣 */
export function routeName(name: Named, lang: Lang): string {
  return (lang === 'zh-TW' ? name.zh || name.en : name.en || name.zh) || ''
}

/** 一種搭法的每一步，一步一行 */
export function busPlanText(plan: BusPlan, lang: Lang): string[] {
  const s = NAV_STRINGS[lang]
  const lines: string[] = []
  plan.rides.forEach((r, i) => {
    const board = stopName(r.board.name, lang)
    if (i === 0) lines.push(fill(s.walkBoard, { m: placeDistance(plan.walkToBoardM, lang), stop: board }))
    else lines.push(fill(s.walkTransfer, { m: placeDistance(plan.transferWalkM, lang), stop: board, bus: routeName(r.route.routeName, lang) }))
    lines.push(fill(s.rideStops, { n: r.stops.length - 1, stop: stopName(r.alight.name, lang) }))
  })
  lines.push(fill(s.walkRest, { m: placeDistance(plan.walkFromAlightM, lang) }))
  return lines
}
