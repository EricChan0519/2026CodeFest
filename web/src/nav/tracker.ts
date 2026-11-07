/**
 * 路線追蹤：目前在路線哪裡、前視目標點、下一個轉彎。純函式／閉包，不碰 DOM。
 * 見 docs/arrow-nav/04-nav-logic.md#每次更新的計算。
 */
import type { LatLon, ManeuverKind, RouteOption } from '@/lib/contract'
import type { NavConfig } from './config'
import { distanceM, lerpLatLon, projectToSegment } from './geo'

export interface TrackState {
  /** 沿路線已走的距離（公尺） */
  alongM: number
  /** 離路線的垂直距離（公尺） */
  offRouteM: number
  /** 沿路線剩餘距離（公尺） */
  remainingM: number
  /** 到終點的直線距離（公尺），抵達判斷用 */
  distToEndM: number
  /** 路線上的前視目標點，不會超過下一個轉彎點 */
  target: LatLon
  /** 路線上最接近目前位置的點 */
  nearest: LatLon
  /** 下一個要提示的轉彎（不含 depart、straight），沒有時為 null */
  nextTurn: { kind: ManeuverKind; distanceM: number; index: number } | null
}

export interface Tracker {
  update(p: LatLon): TrackState
  readonly totalM: number
}

type RouteShape = Pick<RouteOption, 'geometry' | 'maneuvers'>

/** 會讓目標點停下來的轉彎；depart 在起點、straight 只是換路名 */
const isTurn = (k: ManeuverKind) => k !== 'depart' && k !== 'straight'

export function createTracker(
  route: RouteShape,
  cfg: Pick<NavConfig, 'lookaheadM' | 'searchAheadM'>,
): Tracker {
  const g = route.geometry
  // cum[i] = 第 i 個點沿路線的累積距離
  const cum: number[] = [0]
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1]! + distanceM(g[i - 1]!, g[i]!))
  const totalM = cum[cum.length - 1] ?? 0

  const turns = route.maneuvers
    .filter((m) => isTurn(m.kind) && m.atIndex >= 0 && m.atIndex < g.length)
    .map((m) => ({ kind: m.kind, index: m.atIndex, alongM: cum[m.atIndex]! }))
    .sort((a, b) => a.alongM - b.alongM)

  function pointAt(alongM: number): LatLon {
    if (g.length === 0) return [0, 0]
    if (g.length === 1 || alongM <= 0) return g[0]!
    if (alongM >= totalM) return g[g.length - 1]!
    let i = 1
    while (i < g.length - 1 && cum[i]! < alongM) i++
    const segLen = cum[i]! - cum[i - 1]!
    return lerpLatLon(g[i - 1]!, g[i]!, segLen === 0 ? 0 : (alongM - cum[i - 1]!) / segLen)
  }

  let lastAlong = 0 // 只增不減：避免跳回走過的路

  return {
    totalM,
    update(p: LatLon): TrackState {
      const end = g[g.length - 1] ?? p
      if (g.length < 2) {
        const only = g[0] ?? p
        return {
          alongM: 0,
          offRouteM: distanceM(p, only),
          remainingM: 0,
          distToEndM: distanceM(p, end),
          target: only,
          nearest: only,
          nextTurn: null,
        }
      }

      // 1. 找位置：只在 [lastAlong, lastAlong + searchAheadM] 內找最近的投影點
      const lo = lastAlong
      const hi = Math.min(totalM, lastAlong + cfg.searchAheadM)
      let best = { along: lo, distM: Infinity, point: pointAt(lo) }
      for (let i = 1; i < g.length; i++) {
        const s0 = cum[i - 1]!
        const s1 = cum[i]!
        if (s1 < lo || s0 > hi) continue
        const proj = projectToSegment(p, g[i - 1]!, g[i]!)
        let along = s0 + proj.t * (s1 - s0)
        let point = proj.point
        let distM = proj.distM
        if (along < lo || along > hi) {
          along = Math.max(lo, Math.min(hi, along))
          point = pointAt(along)
          distM = distanceM(p, point)
        }
        if (distM < best.distM) best = { along, distM, point }
      }
      lastAlong = Math.max(lastAlong, best.along)
      const alongM = lastAlong

      // 2. 找目標：往前 lookaheadM，但不能超過下一個轉彎點
      const next = turns.find((t) => t.alongM > alongM) ?? null
      let targetAlong = Math.min(totalM, alongM + cfg.lookaheadM)
      if (next) targetAlong = Math.min(targetAlong, next.alongM)

      return {
        alongM,
        offRouteM: best.distM,
        remainingM: Math.max(0, totalM - alongM),
        distToEndM: distanceM(p, end),
        target: pointAt(targetAlong),
        nearest: best.point,
        nextTurn: next ? { kind: next.kind, distanceM: next.alongM - alongM, index: next.index } : null,
      }
    },
  }
}
