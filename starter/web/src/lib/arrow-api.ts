/**
 * 跟著箭頭走後端（api/）的呼叫與資料轉換。
 * 端點：POST /api/stations/nearby、GET /api/stations/search、POST /api/routes。
 * 使用者座標只放 POST body，不放網址（ADR-0005）；search 只送使用者打的字。
 */
import { api } from './api'

export type LatLon = { lat: number; lon: number }

type Station = {
  stationUid: string
  name: { zh: string; en: string | null }
  lat: number
  lon: number
  routes: { routeName: { zh: string; en: string | null } }[]
  distanceM?: number
}

/** 畫面用的地點：目前資料都是 TDX 公車站位 */
export type Place = LatLon & {
  id: string
  name: string
  nameEn: string | null
  category: string
  routes: string[]
  distanceM: number | null
}

export type ManeuverKind = 'depart' | 'straight' | 'slight_left' | 'slight_right' | 'left' | 'right' | 'uturn' | 'stairs' | 'arrive'
type Maneuver = { kind: ManeuverKind; atIndex: number; distanceToNextM: number; street: string | null }
type Route = { id: string; recommended: boolean; distanceM: number; durationS: number; maneuvers: Maneuver[] }

export type NavStep = { angle: number; distance: string; instruction: string }
export type PlannedRoute = { distanceM: number; durationS: number; steps: NavStep[] }

/** 定位失敗或不在服務範圍時的預設起點（圓山捷運站） */
export const FALLBACK_ORIGIN: LatLon & { name: string } = { name: '圓山捷運站', lat: 25.07136, lon: 121.52 }

function toPlace(s: Station, from?: LatLon): Place {
  const routes = [...new Set(s.routes.map(r => r.routeName.zh))]
  return {
    id: s.stationUid,
    name: s.name.zh,
    nameEn: s.name.en,
    category: '公車站牌',
    routes,
    lat: s.lat,
    lon: s.lon,
    distanceM: s.distanceM ?? (from ? Math.round(distanceM(from, s)) : null),
  }
}

export async function nearbyPlaces(at: LatLon, radiusM = 500): Promise<Place[]> {
  const res = await api<{ stations: Station[] }>('/api/stations/nearby', { method: 'POST', body: JSON.stringify({ ...at, radiusM }) })
  return res.stations.map(s => toPlace(s))
}

export async function searchPlaces(q: string, from: LatLon): Promise<Place[]> {
  const res = await api<{ stations: Station[] }>(`/api/stations/search?q=${encodeURIComponent(q)}`)
  return res.stations.map(s => toPlace(s, from)).sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
}

const audienceCode: Record<string, 'elder' | 'child' | 'visitor'> = { '長者': 'elder', '兒童': 'child', '外籍人士': 'visitor', '其他': 'visitor' }

export async function planRoute(from: LatLon, to: Place, audience: string): Promise<PlannedRoute> {
  const res = await api<{ routes: Route[] }>('/api/routes', {
    method: 'POST',
    timeoutMs: 20000,
    body: JSON.stringify({ from, to: { lat: to.lat, lon: to.lon, stationUid: to.id }, audience: audienceCode[audience] ?? 'visitor' }),
  })
  const route = res.routes.find(r => r.recommended) ?? res.routes[0]
  if (!route) throw new Error('no route')
  return { distanceM: route.distanceM, durationS: route.durationS, steps: toSteps(route.maneuvers) }
}

/** 轉彎時箭頭的角度（相對於轉彎前面向的方向） */
const turnAngle: Record<ManeuverKind, number> = { depart: 0, straight: 0, slight_left: -45, slight_right: 45, left: -90, right: 90, uturn: 180, stairs: 0, arrive: 0 }
const turnText: Record<ManeuverKind, string> = {
  depart: '往這個方向走', straight: '繼續直走', slight_left: '稍微向左', slight_right: '稍微向右',
  left: '向左轉', right: '向右轉', uturn: '請向後轉', stairs: '前面有樓梯', arrive: '快到了，繼續往前走',
}

/**
 * 每一段路（從一個 maneuver 走到下一個）是一步：
 * 箭頭先指向這個路口要轉的方向，人轉過去後箭頭回正；距離是這段要走多遠。
 */
export function toSteps(maneuvers: Maneuver[]): NavStep[] {
  const legs = maneuvers.filter(m => m.kind !== 'arrive')
  const steps = legs.map((m, i) => ({ angle: turnAngle[m.kind], distance: formatDistance(m.distanceToNextM), instruction: i === 0 ? turnText.depart : turnText[m.kind] }))
  return steps.length ? steps : [{ angle: 0, distance: formatDistance(0), instruction: turnText.arrive }]
}

/** 100 公尺以上取到 10 公尺；10–100 公尺取到 5 公尺；不到 10 公尺取到 1 公尺（產品規格 01） */
export function formatDistance(m: number) {
  const v = m >= 100 ? Math.round(m / 10) * 10 : m >= 10 ? Math.round(m / 5) * 5 : Math.max(1, Math.round(m))
  return `${v} 公尺`
}

/** 步行分鐘數：長者 3.5 km/h，其他 5.1 km/h（與後端 PedestrianCosting 一致） */
export function walkMinutes(m: number, audience: string) {
  const perMin = (audience === '長者' ? 3.5 : 5.1) * 1000 / 60
  return Math.max(1, Math.ceil(m / perMin))
}

export function distanceM(a: LatLon, b: LatLon) {
  const r = 6371000, d = Math.PI / 180
  const x = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(x))
}

/** 取得目前位置；拒絕、逾時或沒有定位功能時回 null */
export function currentPosition(timeoutMs = 8000): Promise<LatLon | null> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}
