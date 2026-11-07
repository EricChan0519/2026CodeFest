/**
 * 步行路線 adapter（實驗頁用）：呼叫 Valhalla（OpenStreetMap 資料）的 pedestrian 路徑，
 * 轉成合約的 RouteOption 形狀。Valhalla 的格式只出現在這個檔案。
 *
 * 正式路線應來自自己後端的 POST /api/routes（見 docs/arrow-nav/03-contracts.md）。
 * 後端還沒有時，實驗頁直接打公開的 FOSSGIS Valhalla。注意：這會把使用者座標送到第三方伺服器，
 * 正式版不可以這樣做（ADR-0005）。
 *
 * 「避開障礙」的做法：只能靠 OSM 上有的資料——
 * 階梯重罰、盡量不走坡、偏好有人行道、避開小巷與私人車道。
 * 臨時施工、違停、坑洞這類 OSM 沒有的障礙，這裡無法得知。
 *
 * 「先過馬路再轉彎」：Valhalla 的轉彎提示只看路，不知道哪一段是斑馬線。OSM 的斑馬線常畫成一小段折線，
 * 例如士東路 286 巷口的斑馬線先沿路邊往東 14 m 再往北過士東路，Valhalla 就說「右轉」，
 * 人還沒過馬路就聽到右轉（2026-11-07 回報）。所以拿到路線後再問一次 trace_attributes，
 * 把斑馬線上的轉彎併成一個「過馬路」，過完馬路緊接的轉彎變成「過完馬路再○轉」（applyCrossings）。
 */
import type { LatLon, Maneuver, ManeuverKind } from '@/lib/contract'
import { distanceM } from '@/nav/geo'
import type { NavRoute } from '@/nav/machine'

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route'
export const TRACE_ATTRIBUTES_URL = 'https://valhalla1.openstreetmap.de/trace_attributes'

/** 步行偏好：用來避開障礙。數值是實驗起始值，要實地走過再調。 */
export const PEDESTRIAN_COSTING = {
  /** 每遇到一段階梯加的成本（秒），很大＝幾乎不走階梯 */
  step_penalty: 300,
  /** 0 = 完全避開坡，1 = 不在意 */
  use_hills: 0.2,
  /** 小於 1 = 偏好有人行道的路 */
  sidewalk_factor: 0.7,
  /** 大於 1 = 避開小巷、私人車道 */
  alley_factor: 3,
  driveway_factor: 5,
  /** km/h */
  walking_speed: 4.0,
} as const

export interface WalkRoute extends NavRoute {
  id: string
  distanceM: number
  durationS: number
  /** 路線上有幾段階梯（應該是 0） */
  stairsCount: number
  /** 要過幾次馬路；問不到 trace_attributes 時是 null */
  crossCount: number | null
}

interface ValhallaManeuver {
  type: number
  length: number
  time: number
  begin_shape_index: number
  street_names?: string[]
}

interface ValhallaResponse {
  trip?: {
    summary: { length: number; time: number }
    legs: { shape: string; maneuvers: ValhallaManeuver[] }[]
  }
}

/** Valhalla 的 polyline，精度 1e6 */
export function decodePolyline6(str: string): LatLon[] {
  const out: LatLon[] = []
  let i = 0
  let lat = 0
  let lon = 0
  const next = (): number => {
    let result = 0
    let shift = 0
    let b: number
    do {
      b = str.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < str.length) {
    lat += next()
    lon += next()
    out.push([lat / 1e6, lon / 1e6])
  }
  return out
}

/** Valhalla maneuver type → 合約的 ManeuverKind */
export function mapManeuverType(t: number): ManeuverKind {
  switch (t) {
    case 1:
    case 2:
    case 3:
      return 'depart'
    case 4:
    case 5:
    case 6:
      return 'arrive'
    case 9:
    case 23: // stay right
      return 'slight_right'
    case 16:
    case 24: // stay left
      return 'slight_left'
    case 10:
    case 11:
    case 18: // ramp right
    case 20: // exit right
      return 'right'
    case 14:
    case 15:
    case 19:
    case 21:
      return 'left'
    case 12:
    case 13:
      return 'uturn'
    case 40: // steps enter
      return 'stairs'
    default:
      return 'straight'
  }
}

/** 終點離路這麼近，就把路線接到目的地本身（店門口常在路邊幾公尺到十幾公尺外） */
export const END_LINK_MAX_M = 40

/**
 * @param to 要求的終點。Valhalla 會把終點吸附到最近的路上；離目的地不遠時補一段直線過去，
 *   抵達判斷才會以目的地本身為準，不會站在店門口卻「還沒到」。
 */
export function parseValhalla(res: ValhallaResponse, id: string, to?: LatLon): WalkRoute {
  const leg = res.trip?.legs[0]
  if (!res.trip || !leg) throw new Error('ROUTE_NOT_FOUND')
  const geometry = decodePolyline6(leg.shape)
  if (geometry.length < 2) throw new Error('ROUTE_NOT_FOUND')
  if (to) {
    const gap = distanceM(geometry[geometry.length - 1]!, to)
    if (gap > 1 && gap <= END_LINK_MAX_M) geometry.push(to)
  }

  const maneuvers: Maneuver[] = leg.maneuvers.map((m) => ({
    kind: mapManeuverType(m.type),
    atIndex: Math.min(m.begin_shape_index, geometry.length - 1),
    distanceToNextM: Math.round(m.length * 1000),
    street: m.street_names?.[0] ?? null,
  }))
  // 保證最後一個是 arrive，指向最後一個點
  const last = maneuvers[maneuvers.length - 1]
  if (!last || last.kind !== 'arrive') {
    maneuvers.push({ kind: 'arrive', atIndex: geometry.length - 1, distanceToNextM: 0, street: null })
  } else {
    last.atIndex = geometry.length - 1
  }

  return {
    id,
    geometry,
    maneuvers,
    distanceM: Math.round(res.trip.summary.length * 1000),
    durationS: Math.round(res.trip.summary.time),
    stairsCount: maneuvers.filter((m) => m.kind === 'stairs').length,
    crossCount: null,
  }
}

/** trace_attributes 回傳的一段路（只留用得到的欄位） */
export interface TraceEdge {
  /** pedestrian_crossing＝斑馬線；road＝一般道路；footway、sidewalk… */
  use?: string
  /** 道路等級：primary、secondary、tertiary、residential、service_other… */
  road_class?: string
  begin_shape_index: number
  end_shape_index: number
}

/** 斑馬線（連續的 pedestrian_crossing）至少這麼長才算「過馬路」；巷口的短斑馬線（約 7 m）不提示 */
export const CROSSING_MIN_M = 10
/** 過完馬路後這麼近的轉彎，併進「過完馬路再○轉」 */
export const CROSS_THEN_M = 12
/** 轉進大馬路、走這麼短就往反方向轉出去（沒畫斑馬線），表示要過這條馬路 */
export const JOG_MAX_M = 60
/** 要過馬路才能到對面的道路等級（巷弄不算） */
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])

const SIDE: Partial<Record<ManeuverKind, 'left' | 'right'>> = {
  left: 'left',
  slight_left: 'left',
  right: 'right',
  slight_right: 'right',
}

export interface Crossing {
  /** 開始過馬路的 geometry index */
  from: number
  /** 過完馬路的 geometry index */
  to: number
  lengthM: number
}

function cumulative(g: LatLon[]): number[] {
  const cum = [0]
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1]! + distanceM(g[i - 1]!, g[i]!))
  return cum
}

/** 連續的斑馬線邊合成一段；太短的（巷口）不算 */
export function findCrossings(edges: TraceEdge[], geometry: LatLon[], minM = CROSSING_MIN_M): Crossing[] {
  const cum = cumulative(geometry)
  const last = geometry.length - 1
  const out: Crossing[] = []
  let cur: { from: number; to: number } | null = null
  const flush = () => {
    if (!cur) return
    const lengthM = cum[Math.min(cur.to, last)]! - cum[Math.min(cur.from, last)]!
    if (lengthM >= minM) out.push({ ...cur, lengthM })
    cur = null
  }
  for (const e of edges) {
    if (e.use === 'pedestrian_crossing') {
      if (cur && e.begin_shape_index === cur.to) cur.to = e.end_shape_index
      else {
        flush()
        cur = { from: e.begin_shape_index, to: e.end_shape_index }
      }
    } else flush()
  }
  flush()
  return out
}

/** 會在轉彎點停下來、可以被「過馬路」吸收的提示（起點、終點、階梯不動） */
const absorbable = (k: ManeuverKind) => k !== 'depart' && k !== 'arrive' && k !== 'stairs' && k !== 'cross'
const RANK: Partial<Record<ManeuverKind, number>> = { depart: 0, cross: 1, arrive: 3 }

/**
 * 把「過馬路」放進轉彎提示：
 * 1. 每段斑馬線變成一個 cross（atIndex＝對面、fromIndex＝起點），斑馬線起點到對面之間的轉彎都併進去，
 *    不會再「還沒過馬路就說右轉」。
 * 2. 過完馬路 CROSS_THEN_M 內的轉彎併成 cross.then：「過完馬路再右轉」。
 * 3. 沒畫斑馬線、但路線轉進大馬路走一小段就往反方向轉出去（右轉再左轉）：這條馬路一定要過，
 *    在第一個路口先過（和 Google 一樣），那個轉彎改成「過完馬路再右轉」。
 */
export function applyCrossings(maneuvers: Maneuver[], geometry: LatLon[], edges: TraceEdge[]): Maneuver[] {
  const cum = cumulative(geometry)
  const along = (i: number) => cum[Math.max(0, Math.min(i, cum.length - 1))]!
  let ms = maneuvers.map((m) => ({ ...m }))
  let changed = false

  for (const c of findCrossings(edges, geometry)) {
    changed = true
    const a0 = along(c.from)
    const a1 = along(c.to)
    ms = ms.filter((m) => !(absorbable(m.kind) && along(m.atIndex) >= a0 - 3 && along(m.atIndex) < a1))
    let then: ManeuverKind | null = null
    const after = ms
      .filter((m) => m.kind !== 'cross' && along(m.atIndex) >= a1)
      .sort((x, y) => along(x.atIndex) - along(y.atIndex))[0]
    if (after && absorbable(after.kind) && after.kind !== 'straight' && along(after.atIndex) - a1 <= CROSS_THEN_M) {
      then = after.kind
      ms = ms.filter((m) => m !== after)
    }
    ms.push({ kind: 'cross', atIndex: c.to, fromIndex: c.from, distanceToNextM: 0, street: null, then })
  }

  const sortMs = () =>
    ms.sort((x, y) => along(x.atIndex) - along(y.atIndex) || (RANK[x.kind] ?? 2) - (RANK[y.kind] ?? 2))
  sortMs()

  const onMajorRoad = (from: number, to: number) => {
    const inside = edges.filter((e) => e.begin_shape_index >= from && e.end_shape_index <= to)
    return inside.length > 0 && inside.every((e) => e.use === 'road' && MAJOR_ROADS.has(e.road_class ?? ''))
  }
  for (let i = 0; i + 1 < ms.length; i++) {
    const m = ms[i]!
    const n = ms[i + 1]!
    const s1 = SIDE[m.kind]
    const s2 = SIDE[n.kind]
    if (!s1 || !s2 || s1 === s2) continue
    if (along(n.atIndex) - along(m.atIndex) > JOG_MAX_M) continue
    if (!onMajorRoad(m.atIndex, n.atIndex)) continue
    ms[i] = { ...m, kind: 'cross', fromIndex: m.atIndex, then: m.kind }
    changed = true
  }

  if (!changed) return maneuvers
  for (let i = 0; i < ms.length; i++) {
    const next = ms[i + 1]
    ms[i]!.distanceToNextM = next ? Math.round(along(next.atIndex) - along(ms[i]!.atIndex)) : 0
  }
  return ms
}

/** 問 Valhalla 這條路線每一段是什麼（斑馬線、道路等級）；路線形狀對不上時回傳 null */
export async function fetchTraceEdges(shape: string, pointCount: number, timeoutMs = 5000): Promise<TraceEdge[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(TRACE_ATTRIBUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        encoded_polyline: shape,
        shape_match: 'edge_walk',
        costing: 'pedestrian',
        filters: {
          attributes: ['edge.use', 'edge.road_class', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'],
          action: 'include',
        },
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { edges?: TraceEdge[]; shape?: string }
    if (!body.edges || !body.shape) return null
    // edge 的 index 要對得上路線的 geometry 才能用
    if (decodePolyline6(body.shape).length !== pointCount) return null
    if (body.edges.some((e) => !(e.begin_shape_index >= 0 && e.end_shape_index < pointCount))) return null
    return body.edges
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWalkRoute(
  from: LatLon,
  to: LatLon,
  opts: { id?: string; timeoutMs?: number } = {},
): Promise<WalkRoute> {
  const { id = 'walk-valhalla', timeoutMs = 15000 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        locations: [
          { lat: from[0], lon: from[1] },
          { lat: to[0], lon: to[1] },
        ],
        costing: 'pedestrian',
        costing_options: { pedestrian: PEDESTRIAN_COSTING },
        directions_options: { units: 'kilometers' },
      }),
    })
    if (!res.ok) throw new Error(`ROUTE_HTTP_${res.status}`)
    const json = (await res.json()) as ValhallaResponse
    const route = parseValhalla(json, id, to)
    clearTimeout(timer)
    // 斑馬線資訊拿不到也照樣走，只是少了「過馬路」提示
    const shape = json.trip!.legs[0]!.shape
    const edges = await fetchTraceEdges(shape, decodePolyline6(shape).length).catch(() => null)
    if (edges) {
      route.maneuvers = applyCrossings(route.maneuvers, route.geometry, edges)
      route.crossCount = route.maneuvers.filter((m) => m.kind === 'cross').length
    }
    return route
  } finally {
    clearTimeout(timer)
  }
}
