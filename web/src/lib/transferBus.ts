/**
 * 沒有直達車時，找「轉一次車」的搭法：第一班坐到轉乘站，走到第二班的站牌，再坐到目的地附近。
 *
 * 和直達車一樣只用 TDX 公車路線停靠順序（政府開放資料快照），整個計算在裝置上做。
 * 轉乘站：同一個站位、同名站位 300 公尺內（常是對面那一側），或任何 80 公尺內的站位。
 * 距離是直線距離，只用來排序和篩選；每一段步行路線交給導航。
 */
import type { LatLon, Station } from '@/lib/contract'
import { distanceM } from '@/nav/geo'
import type { Ride } from '@/nav/journey'
import { planDirectBus, type PlanOptions, type RoutePattern } from './directBus'

export interface TransferOption {
  /** 兩段公車：第一段下車後走到第二段的上車站 */
  rides: [Ride, Ride]
  walkToBoardM: number
  transferWalkM: number
  walkFromAlightM: number
  /** 兩段合計坐幾站 */
  stopCount: number
}

export const TRANSFER_SAME_NAME_M = 300
export const TRANSFER_ANY_M = 80
/** 排序時坐一站約等於走幾公尺（一站約一分鐘，步行一分鐘約 80 公尺）；避免為了少走幾步繞一大圈 */
export const STOP_COST_M = 80

interface Leg {
  pattern: RoutePattern
  board: number
  alight: number
  walkM: number
}

function nearby(stations: Station[], point: LatLon, maxM: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of stations) {
    const d = distanceM(point, [s.lat, s.lon])
    if (d <= maxM) out.set(s.stationUid, d)
  }
  return out
}

/** 每條路線最近的可上車站之後，每個可下車站 → 這段（同一站只留走路最少的幾條路線） */
function legsFromStart(patterns: RoutePattern[], nearFrom: Map<string, number>): Map<string, Leg[]> {
  const out = new Map<string, Leg[]>()
  for (const p of patterns) {
    const noBoard = new Set(p.noBoard)
    const noAlight = new Set(p.noAlight)
    let board = -1
    let walkM = Infinity
    p.stops.forEach((uid, i) => {
      if (board >= 0 && !noAlight.has(i) && uid !== p.stops[board]) push(out, uid, { pattern: p, board, alight: i, walkM })
      const w = nearFrom.get(uid)
      if (w !== undefined && !noBoard.has(i) && w < walkM) {
        board = i
        walkM = w
      }
    })
  }
  return out
}

/** 每條路線最近的可下車站之前，每個可上車站 → 這段 */
function legsToEnd(patterns: RoutePattern[], nearTo: Map<string, number>): Map<string, Leg[]> {
  const out = new Map<string, Leg[]>()
  for (const p of patterns) {
    const noBoard = new Set(p.noBoard)
    const noAlight = new Set(p.noAlight)
    let alight = -1
    let walkM = Infinity
    for (let i = p.stops.length - 1; i >= 0; i--) {
      const uid = p.stops[i]
      if (alight >= 0 && !noBoard.has(i) && uid !== p.stops[alight]) push(out, uid, { pattern: p, board: i, alight, walkM })
      const w = nearTo.get(uid)
      if (w !== undefined && !noAlight.has(i) && w < walkM) {
        alight = i
        walkM = w
      }
    }
  }
  return out
}

const KEEP_PER_STOP = 4
function push(map: Map<string, Leg[]>, uid: string, leg: Leg) {
  const list = map.get(uid) ?? []
  list.push(leg)
  list.sort((a, b) => a.walkM - b.walkM || a.alight - a.board - (b.alight - b.board))
  if (list.length > KEEP_PER_STOP) list.length = KEEP_PER_STOP
  map.set(uid, list)
}

function toRide(leg: Leg, byUid: Map<string, Station>): Ride | null {
  const p = leg.pattern
  const board = byUid.get(p.stops[leg.board])
  const alight = byUid.get(p.stops[leg.alight])
  const route = board?.routes.find((r) => r.routeName.zh === p.routeName.zh && r.direction === p.direction)
  if (!board || !alight || !route) return null
  const stops = p.stops.slice(leg.board, leg.alight + 1).map((uid) => byUid.get(uid)).filter((s): s is Station => !!s)
  return { mode: 'bus', board, route, alight, stops }
}

export function planTransferBus(
  stations: Station[],
  patterns: RoutePattern[],
  from: LatLon,
  to: LatLon,
  { maxWalkM = 500, limit = 3 }: PlanOptions = {},
): TransferOption[] {
  const nearFrom = nearby(stations, from, maxWalkM)
  const nearTo = nearby(stations, to, maxWalkM)
  if (nearFrom.size === 0 || nearTo.size === 0) return []

  const byUid = new Map(stations.map((s) => [s.stationUid, s]))
  const first = legsFromStart(patterns, nearFrom)
  const second = legsToEnd(patterns, nearTo)
  const secondStations = [...second.keys()].map((uid) => byUid.get(uid)).filter((s): s is Station => !!s)

  const direct = distanceM(from, to)
  const best = new Map<string, { a: Leg; b: Leg; cost: number; transferM: number }>()
  for (const [uid, legsA] of first) {
    const here = byUid.get(uid)
    if (!here) continue
    for (const there of secondStations) {
      const transferM = there.stationUid === uid ? 0 : distanceM([here.lat, here.lon], [there.lat, there.lon])
      const ok = transferM <= TRANSFER_ANY_M || (there.name.zh === here.name.zh && transferM <= TRANSFER_SAME_NAME_M)
      if (!ok) continue
      for (const a of legsA) {
        for (const b of second.get(there.stationUid)!) {
          if (a.pattern.routeName.zh === b.pattern.routeName.zh) continue
          const walk = a.walkM + transferM + b.walkM
          if (walk >= direct) continue
          const stops = a.alight - a.board + (b.alight - b.board)
          const key = `${a.pattern.routeName.zh}|${a.pattern.direction}>${b.pattern.routeName.zh}|${b.pattern.direction}`
          const cost = walk + stops * STOP_COST_M
          const prev = best.get(key)
          if (prev && prev.cost <= cost) continue
          best.set(key, { a, b, cost, transferM })
        }
      }
    }
  }

  const out: TransferOption[] = []
  const ranked = [...best.values()].sort((x, y) => x.cost - y.cost)
  for (const c of ranked) {
    const r1 = toRide(c.a, byUid)
    const r2 = toRide(c.b, byUid)
    if (!r1 || !r2) continue
    out.push({
      rides: [r1, r2],
      walkToBoardM: c.a.walkM,
      transferWalkM: c.transferM,
      walkFromAlightM: c.b.walkM,
      stopCount: c.a.alight - c.a.board + (c.b.alight - c.b.board),
    })
    if (out.length >= limit) break
  }
  return out
}

/** 畫面用的一種搭法：一段（直達）或兩段（轉一次車） */
export interface BusPlan {
  rides: Ride[]
  walkToBoardM: number
  /** 直達車是 0 */
  transferWalkM: number
  walkFromAlightM: number
  stopCount: number
}

/**
 * 值不值得搭：估計的時間要比直接走過去短，而且至少少走 MIN_WALK_SAVED_M。
 * 2026-11-07 實測：目的地只有 290 公尺，卻列出「坐 1 站 → 轉車 → 坐 1 站」，
 * 走路只少 60 公尺、加上等兩次車反而慢很多。這種不划算的搭法不列。
 */
/** 步行速度（公尺／分鐘），和 walkRoute 的 walking_speed 4 km/h 一致 */
export const WALK_M_PER_MIN = 67
/** 每上一次車平均要等幾分鐘 */
export const WAIT_MIN_PER_BOARDING = 5
/** 坐一站約幾分鐘（含停靠） */
export const MIN_PER_STOP = 1.5
/** 至少要少走這麼多公尺才建議搭車 */
export const MIN_WALK_SAVED_M = 300

export function estimateBusMin(plan: Pick<BusPlan, 'rides' | 'walkToBoardM' | 'transferWalkM' | 'walkFromAlightM' | 'stopCount'>): number {
  const walkM = plan.walkToBoardM + plan.transferWalkM + plan.walkFromAlightM
  return walkM / WALK_M_PER_MIN + plan.rides.length * WAIT_MIN_PER_BOARDING + plan.stopCount * MIN_PER_STOP
}

export function isWorthRiding(plan: BusPlan, directM: number): boolean {
  const walkM = plan.walkToBoardM + plan.transferWalkM + plan.walkFromAlightM
  return directM - walkM >= MIN_WALK_SAVED_M && estimateBusMin(plan) < directM / WALK_M_PER_MIN
}

/** 先找直達車；沒有直達才找轉一次車。不划算的搭法（不比走路快、或省不到幾步路）都不列 */
export function planBus(stations: Station[], patterns: RoutePattern[], from: LatLon, to: LatLon): BusPlan[] {
  const directM = distanceM(from, to)
  // 走路比 MIN_WALK_SAVED_M 還近，怎麼搭都省不到路
  if (directM < MIN_WALK_SAVED_M) return []
  const direct: BusPlan[] = planDirectBus(stations, patterns, from, to).map((o) => ({
    rides: [{ mode: 'bus', board: o.board, route: o.route, alight: o.alight, stops: o.stops }],
    walkToBoardM: o.walkToBoardM,
    transferWalkM: 0,
    walkFromAlightM: o.walkFromAlightM,
    stopCount: o.stopCount,
  }))
  const worthDirect = direct.filter((o) => isWorthRiding(o, directM))
  if (worthDirect.length > 0) return worthDirect
  // 有直達車但不划算時，轉車只會更不划算
  if (direct.length > 0) return []
  return planTransferBus(stations, patterns, from, to).filter((o) => isWorthRiding(o, directM))
}
