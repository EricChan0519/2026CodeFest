/**
 * 路線追蹤：目前在路線哪裡、前視目標點、下一個轉彎。純函式／閉包，不碰 DOM。
 * 見 docs/arrow-nav/04-nav-logic.md#每次更新的計算。
 */
import type { LatLon, ManeuverKind, RouteOption } from '@/lib/contract'
import { crossPassM, turnPassM } from './config'
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
  /** 路線上的前視目標點，不會超過下一個「還沒通過」的轉彎點 */
  target: LatLon
  /** 路線上最接近目前位置的點 */
  nearest: LatLon
  /**
   * 下一個還沒通過的轉彎（不含 depart、straight、arrive），沒有時為 null。
   * cross（過馬路）多兩個欄位：then＝過完要轉的方向；startM＝離開始過馬路的地方還有多遠（已經在過就是 0）
   */
  nextTurn: { kind: ManeuverKind; distanceM: number; index: number; then?: ManeuverKind | null; startM?: number } | null
}

export interface Tracker {
  /** accuracyM 用來算 turnPassM；不給時當作 0（turnPassM = 8 公尺） */
  update(p: LatLon, accuracyM?: number): TrackState
  readonly totalM: number
}

type RouteShape = Pick<RouteOption, 'geometry' | 'maneuvers'>

/** 會讓目標點停下來的轉彎；depart 在起點、straight 只是換路名、arrive 是終點（由抵達判斷處理） */
const isTurn = (k: ManeuverKind) => k !== 'depart' && k !== 'straight' && k !== 'arrive'

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
    .map((m) => ({
      kind: m.kind,
      index: m.atIndex,
      alongM: cum[m.atIndex]!,
      point: g[m.atIndex]!,
      cross: m.kind === 'cross',
      then: m.then ?? null,
      startAlongM: cum[Math.max(0, Math.min(m.fromIndex ?? m.atIndex, m.atIndex))]!,
    }))
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
  let passed = 0 // turns[0..passed) 已通過；只增不減，通過後不會退回

  return {
    totalM,
    update(p: LatLon, accuracyM = 0): TrackState {
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

      // 2. 通過轉彎：投影已到（或超過）轉彎點，或人離轉彎點 turnPassM 以內。
      //    GPS 已過轉角、投影還在轉角前時，目標點才不會落在背後叫人向後轉。
      //    只看搜尋視窗內的轉彎，避免折返路線上「之後才會經過」的轉角剛好在旁邊。
      //    過馬路的「對面」用比較小的範圍，站在這一側路邊不會被當成已經過了。
      const passM = turnPassM(accuracyM)
      const crossM = crossPassM(accuracyM)
      while (passed < turns.length) {
        const t = turns[passed]!
        const reached = t.alongM <= lastAlong + 1e-6
        const near = t.alongM - lastAlong <= cfg.searchAheadM && distanceM(p, t.point) <= (t.cross ? crossM : passM)
        if (!reached && !near) break
        lastAlong = Math.max(lastAlong, t.alongM)
        passed++
      }
      const alongM = lastAlong

      // 3. 找目標：往前 lookaheadM，但不能超過下一個還沒通過的轉彎點
      const next = turns[passed] ?? null
      let targetAlong = Math.min(totalM, alongM + cfg.lookaheadM)
      if (next) targetAlong = Math.min(targetAlong, next.alongM)

      return {
        alongM,
        offRouteM: best.distM,
        remainingM: Math.max(0, totalM - alongM),
        distToEndM: distanceM(p, end),
        target: pointAt(targetAlong),
        nearest: best.point,
        nextTurn: next
          ? {
              kind: next.kind,
              distanceM: next.alongM - alongM,
              index: next.index,
              ...(next.cross ? { then: next.then, startM: Math.max(0, next.startAlongM - alongM) } : {}),
            }
          : null,
      }
    },
  }
}
