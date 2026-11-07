/**
 * 路線模式（快速／安全／平緩）的步行路線：打自己後端的 POST /api/routes（mode），
 * 後端用 Valhalla 產生多條候選、量測路燈／監視器／派出所／便利商店／坡度／階梯，
 * 在「不超過最快路線 1.2 倍時間」的條件下挑一條（api/app/route_modes.py）。
 *
 * 回來的每條路都轉成導航用的 WalkRoute：
 * - 終點離路不遠時補一段直線到目的地（和 walkRoute.ts 的 parseValhalla 一樣）。
 * - 後端附上的路段種類（edges）直接拿來判斷過馬路（applyCrossings），不用再把路線送到公開伺服器。
 *
 * 後端連不上時退回公開的 FOSSGIS Valhalla 最快路線（fetchWalkRoute），fallback 標成 true，
 * 畫面要說「暫時只能找最快的路」。
 */
import { api } from './api'
import type { Audience, LatLon, Maneuver, Metrics, RouteDiff, RouteMode, RouteOption } from './contract'
import { distanceM } from '@/nav/geo'
import { applyCrossings, END_LINK_MAX_M, fetchWalkRoute } from './walkRoute'
import type { TraceEdge, WalkRoute } from './walkRoute'

export interface ModeRoute extends WalkRoute {
  /** 'fastest'，或推薦的路線模式（'safe'、'gentle'） */
  id: string
  recommended: boolean
  /** 後端的原因代碼（fewer_steps、more_cameras…）；最快路線是 ['fastest'] */
  reasons: string[]
  metrics: Metrics | null
  /** 和最快路線比（正數＝比較好）；最快路線是 null */
  diff: RouteDiff | null
}

export interface RoutePlan {
  mode: RouteMode
  /** [0] 是推薦的路；和最快不同時 [1] 是最快路線 */
  routes: ModeRoute[]
  notes: string[]
  period: 'day' | 'night'
  /** 後端失敗，改用公開 Valhalla 的最快路線 */
  fallback: boolean
  /** 算路線時的起點（導航開始時離這裡不遠，就直接用這條路） */
  from: LatLon
}

const toTraceEdges = (edges: NonNullable<RouteOption['edges']>): TraceEdge[] =>
  edges.map(([begin, end, use, roadClass]) => ({
    begin_shape_index: begin,
    end_shape_index: end,
    use: use ?? undefined,
    road_class: roadClass ?? undefined,
  }))

/** 後端的 RouteOption → 導航用的路線 */
export function toModeRoute(o: RouteOption, to?: LatLon): ModeRoute {
  if (o.geometry.length < 1) throw new Error('ROUTE_NOT_FOUND')
  const geometry: LatLon[] = o.geometry.map((p) => [p[0], p[1]])
  if (to) {
    const gap = distanceM(geometry[geometry.length - 1]!, to)
    if (gap > 1 && gap <= END_LINK_MAX_M) geometry.push(to)
  }
  let maneuvers: Maneuver[] = o.maneuvers.map((m) => ({ ...m, atIndex: Math.min(m.atIndex, geometry.length - 1) }))
  const last = maneuvers[maneuvers.length - 1]
  if (!last || last.kind !== 'arrive') {
    maneuvers.push({ kind: 'arrive', atIndex: geometry.length - 1, distanceToNextM: 0, street: null })
  } else {
    last.atIndex = geometry.length - 1
  }
  let crossCount: number | null = null
  if (o.edges && o.edges.length) {
    maneuvers = applyCrossings(maneuvers, geometry, toTraceEdges(o.edges))
    crossCount = maneuvers.filter((m) => m.kind === 'cross').length
  }
  return {
    id: o.id,
    recommended: o.recommended,
    reasons: o.reasons,
    metrics: o.metrics,
    diff: o.diff,
    geometry,
    maneuvers,
    distanceM: o.distanceM,
    durationS: o.durationS,
    stairsCount: maneuvers.filter((m) => m.kind === 'stairs').length,
    crossCount,
  }
}

export async function fetchRoutePlan(
  from: LatLon,
  to: LatLon,
  mode: RouteMode,
  audience: Audience,
  opts: { simulate?: 'night' | null; quick?: boolean } = {},
): Promise<RoutePlan> {
  try {
    const res = await api.routes({
      from: { lat: from[0], lon: from[1] },
      to: { lat: to[0], lon: to[1] },
      audience,
      candidate: null,
      simulate: opts.simulate ?? null,
      mode,
      ...(opts.quick ? { quick: true } : {}),
    })
    const routes = res.routes.map((r) => toModeRoute(r, to))
    if (!routes.length) throw new Error('ROUTE_NOT_FOUND')
    return { mode, routes, notes: res.notes, period: res.context.period, fallback: false, from }
  } catch (err) {
    // 後端說找不到路就是找不到；其他錯誤（離線、逾時、5xx）才退回公開伺服器
    if ((err as { code?: string }).code === 'ROUTE_NOT_FOUND' || (err as { code?: string }).code === 'OUT_OF_AREA') throw err
    const walk = await fetchWalkRoute(from, to, { id: 'fastest' })
    const route: ModeRoute = { ...walk, recommended: true, reasons: ['fastest'], metrics: null, diff: null }
    return { mode, routes: [route], notes: [], period: 'day', fallback: true, from }
  }
}

/** 導航開始時目前位置離規劃時的位置（RoutePlan.from）這麼近，就沿用規劃好的路（使用者看到的就是要走的） */
export const PLAN_REUSE_M = 40
