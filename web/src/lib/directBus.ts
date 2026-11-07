/**
 * 「要去 A，搭哪一班公車」：只找直達車，不做轉乘。
 *
 * 資料是 TDX 公車路線停靠順序（StopOfRoute，政府開放資料），由 scripts/build_stop_index.py
 * 放進站位快照的 patterns。整個計算在裝置上做，不呼叫外部規劃服務，關掉網路也能算。
 * 距離是直線距離，只用來排序和篩選；實際步行路線交給導航。
 */
import type { BilingualName, LatLon, Station, StationRoute } from '@/lib/contract'
import { distanceM } from '@/nav/geo'

/** 一條路線、一個方向的停靠順序；stops 是 stationUid，noBoard／noAlight 是 stops 的索引 */
export interface RoutePattern {
  routeName: { zh: string; en: string | null }
  direction: number
  headsign: BilingualName
  stops: string[]
  noBoard: number[]
  noAlight: number[]
  /**
   * 起點站首末班發車時間（秒，從 0 點起；營運日從 04:00 算，00:30 記成 24:30）。
   * 來自 TDX Bus Schedule；沒有資料時不判斷末班車。
   */
  service?: { weekday: [number, number] | null; weekend: [number, number] | null }
}

export interface DirectBusOption {
  /** 上車站位：導航目的地 */
  board: Station
  /** board.routes 裡的那一筆，直接交給 destinationFromStation／arrivalFromStation */
  route: StationRoute
  /** 下車站位 */
  alight: Station
  walkToBoardM: number
  walkFromAlightM: number
  /** 坐幾站 */
  stopCount: number
  /** 上車站到下車站沿途每一站（含頭尾），坐車畫面用來算還有幾站 */
  stops: Station[]
}

export interface PlanOptions {
  /** 起點、終點各自最多走多遠（直線），預設 500 公尺 */
  maxWalkM?: number
  limit?: number
}

function nearby(stations: Station[], point: LatLon, maxM: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of stations) {
    const d = distanceM(point, [s.lat, s.lon])
    if (d <= maxM) out.set(s.stationUid, d)
  }
  return out
}

export function planDirectBus(
  stations: Station[],
  patterns: RoutePattern[],
  from: LatLon,
  to: LatLon,
  { maxWalkM = 500, limit = 5 }: PlanOptions = {},
): DirectBusOption[] {
  const byUid = new Map(stations.map((s) => [s.stationUid, s]))
  const nearFrom = nearby(stations, from, maxWalkM)
  const nearTo = nearby(stations, to, maxWalkM)
  if (nearFrom.size === 0 || nearTo.size === 0) return []

  const best = new Map<string, DirectBusOption>()
  for (const p of patterns) {
    const noBoard = new Set(p.noBoard)
    const noAlight = new Set(p.noAlight)
    // 由前往後掃：記住目前為止最近的上車站，遇到終點附近可下車的站就算一次
    let boardAt = -1
    let boardWalk = Infinity
    let pick: { board: number; alight: number; walk: number; alightWalk: number; boardWalk: number } | null = null
    p.stops.forEach((uid, i) => {
      const alightWalk = nearTo.get(uid)
      if (boardAt >= 0 && alightWalk !== undefined && !noAlight.has(i) && uid !== p.stops[boardAt]) {
        const walk = boardWalk + alightWalk
        if (!pick || walk < pick.walk) pick = { board: boardAt, alight: i, walk, alightWalk, boardWalk }
      }
      const walk = nearFrom.get(uid)
      if (walk !== undefined && !noBoard.has(i) && walk < boardWalk) {
        boardAt = i
        boardWalk = walk
      }
    })
    if (!pick) continue
    const { board: bi, alight: ai, walk, alightWalk, boardWalk: bw } = pick
    const board = byUid.get(p.stops[bi])
    const alight = byUid.get(p.stops[ai])
    const route = board?.routes.find((r) => r.routeName.zh === p.routeName.zh && r.direction === p.direction)
    if (!board || !alight || !route) continue

    const key = `${p.routeName.zh}|${p.direction}`
    const prev = best.get(key)
    if (prev && prev.walkToBoardM + prev.walkFromAlightM <= walk) continue
    const stops = p.stops.slice(bi, ai + 1).map((uid) => byUid.get(uid)).filter((s): s is Station => !!s)
    best.set(key, { board, route, alight, walkToBoardM: bw, walkFromAlightM: alightWalk, stopCount: ai - bi, stops })
  }

  // 搭車要走的路不比直接走過去少，就不建議搭車
  const direct = distanceM(from, to)
  return [...best.values()]
    .filter((o) => o.walkToBoardM + o.walkFromAlightM < direct)
    .sort((a, b) => a.walkToBoardM + a.walkFromAlightM - (b.walkToBoardM + b.walkFromAlightM) || a.stopCount - b.stopCount)
    .slice(0, limit)
}
