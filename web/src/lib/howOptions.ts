/**
 * 「怎麼去」的三個選項（走路、公車、捷運）各自要列哪個方案、能不能選。
 *
 * - 公車：只搭公車的方案；捷運：有搭捷運的方案（只搭捷運，或公車接捷運的混搭）。
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

export function pickOption(candidates: TransitPlan[], from: LatLon, to: LatLon, mode: RouteMode): HowOption {
  const near = candidates.filter((p) => p.rides.length > 0 && isNear(p, from, to))
  if (near.length === 0) return { status: 'none', plan: null }
  const ok = near.filter((p) => p.service === 'ok')
  if (ok.length === 0) return { status: near.some((p) => p.service === 'ended') ? 'ended' : 'not_started', plan: null }
  return { status: 'ok', plan: ok[pickByMode(ok.map(comparable), mode)]! }
}

/** 公車那一列的候選：只搭公車 */
export function busCandidates(plans: Record<'mixed' | 'bus' | 'metro', TransitPlan[]>): TransitPlan[] {
  return plans.bus
}

/** 捷運那一列的候選：只搭捷運，加上公車接捷運的混搭 */
export function metroCandidates(plans: Record<'mixed' | 'bus' | 'metro', TransitPlan[]>): TransitPlan[] {
  return [...plans.metro, ...plans.mixed.filter((p) => p.rides.some((r) => r.mode === 'metro'))]
}
