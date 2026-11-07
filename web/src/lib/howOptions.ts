/**
 * 「怎麼去」的選項（最佳、走路、公車、捷運）各自要列哪些方案、能不能選。
 *
 * - 最佳：公車、捷運、走路混搭；公車：只搭公車＋走路；捷運：只搭捷運＋走路。
 * - 附近沒有站（上車站離出發點、下車站離目的地都要在 NEAR_M 內）→ none（路線無公車／捷運）。
 * - 附近有站但現在都搭不到 → ended（末班車已過）或 not_started（首班車還沒開）。
 * - 能搭的方案裡，依使用者的路線模式挑最合適的一個（pickByMode）。
 */
import type { LatLon, RouteMode } from './contract'
import { distanceM } from '@/nav/geo'
import type { TransitPlan } from './transitPlan'

/** 「附近」：上車站離出發點、下車站離目的地多遠以內（約走 20 分鐘） */
export const NEAR_M = 1500
/** 安全、平緩模式：可以比最快的選項慢多少（和走路路線模式的 1.2 倍一致） */
export const MODE_SLACK = 1.2
/** 安全、平緩模式：走路的時間多算一半，比較少走路的排前面 */
export const WALK_WEIGHT = 0.5
/** 安全、平緩模式：每轉一次車多算幾秒 */
export const TRANSFER_PENALTY_S = 180

export type HowStatus = 'ok' | 'none' | 'ended' | 'not_started'

export interface HowOption {
  status: HowStatus
  /** status 是 ok 時才有 */
  plan: TransitPlan | null
}

/** 比較用的最小資訊：走路的選項也能放進來比 */
export interface Comparable {
  durationS: number
  walkS: number
  rides: number
}

function score(c: Comparable, mode: RouteMode): number {
  if (mode === 'fast') return c.durationS
  return c.durationS + WALK_WEIGHT * c.walkS + TRANSFER_PENALTY_S * Math.max(0, c.rides - 1)
}

/**
 * 依路線模式挑一個：快速 → 最快；安全、平緩 → 在不超過最快 1.2 倍時間的裡面，少走路、少轉車的優先。
 * 回傳 index，空陣列回傳 -1。
 */
export function pickByMode(items: Comparable[], mode: RouteMode): number {
  if (items.length === 0) return -1
  const fastest = Math.min(...items.map((c) => c.durationS))
  let best = -1
  items.forEach((c, i) => {
    if (c.durationS > fastest * MODE_SLACK) return
    if (best < 0 || score(c, mode) < score(items[best]!, mode)) best = i
  })
  return best
}

export const comparable = (p: TransitPlan): Comparable => ({ durationS: p.durationS, walkS: p.walkS, rides: p.rides.length })

function isNear(p: TransitPlan, from: LatLon, to: LatLon): boolean {
  const first = p.rides[0]
  const last = p.rides[p.rides.length - 1]
  if (!first || !last) return false
  return distanceM(from, [first.board.lat, first.board.lon]) <= NEAR_M && distanceM(to, last.alightPoint ?? [last.alight.lat, last.alight.lon]) <= NEAR_M
}

export interface HowList {
  status: HowStatus
  /** 現在搭得到的，依路線模式最合適的排第一，其餘依時間 */
  ok: TransitPlan[]
  /** 附近有站但現在搭不到的（末班車已過、首班車還沒開），依時間 */
  unavailable: TransitPlan[]
}

/** 附近的方案分成搭得到、搭不到兩組；搭得到的依路線模式把最合適的排第一 */
export function listOptions(candidates: TransitPlan[], from: LatLon, to: LatLon, mode: RouteMode): HowList {
  const near = candidates.filter((p) => p.rides.length > 0 && isNear(p, from, to))
  const byTime = (a: TransitPlan, b: TransitPlan) => a.durationS - b.durationS
  const ok = near.filter((p) => p.service === 'ok').sort(byTime)
  const unavailable = near.filter((p) => p.service !== 'ok').sort(byTime)
  const best = pickByMode(ok.map(comparable), mode)
  if (best > 0) ok.unshift(...ok.splice(best, 1))
  const status: HowStatus =
    near.length === 0 ? 'none' : ok.length > 0 ? 'ok' : unavailable.some((p) => p.service === 'ended') ? 'ended' : 'not_started'
  return { status, ok, unavailable }
}

type Plans = Record<'mixed' | 'bus' | 'metro', TransitPlan[]>

/** 最佳的候選：公車、捷運混搭（走路另外由走路路線加進來） */
export const bestCandidates = (plans: Plans): TransitPlan[] => plans.mixed
/** 公車的候選：只搭公車 */
export const busCandidates = (plans: Plans): TransitPlan[] => plans.bus
/** 捷運的候選：只搭捷運 */
export const metroCandidates = (plans: Plans): TransitPlan[] => plans.metro
