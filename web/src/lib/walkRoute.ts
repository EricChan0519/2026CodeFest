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
 */
import type { LatLon, Maneuver, ManeuverKind } from '@/lib/contract'
import type { NavRoute } from '@/nav/machine'

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route'

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

export function parseValhalla(res: ValhallaResponse, id: string): WalkRoute {
  const leg = res.trip?.legs[0]
  if (!res.trip || !leg) throw new Error('ROUTE_NOT_FOUND')
  const geometry = decodePolyline6(leg.shape)
  if (geometry.length < 2) throw new Error('ROUTE_NOT_FOUND')

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
    return parseValhalla((await res.json()) as ValhallaResponse, id)
  } finally {
    clearTimeout(timer)
  }
}
