/**
 * 介面合約型別，逐字對應 docs/arrow-nav/03-contracts.md。
 * 座標：陣列 [lat, lon]，物件 { lat, lon }（WGS84）。距離 M、時間 S。
 */

export type Audience = 'elder' | 'child' | 'visitor'
export type Lang = 'zh-TW' | 'en' | 'th' | 'vi' | 'id' | 'km' | 'ja' | 'ko'
export type LatLon = [number, number]

export type ManeuverKind =
  | 'depart'
  | 'straight'
  | 'slight_left'
  | 'slight_right'
  | 'left'
  | 'right'
  | 'uturn'
  | 'stairs'
  | 'arrive'

export interface Maneuver {
  kind: ManeuverKind
  atIndex: number
  distanceToNextM: number
  street: string | null
}

export interface Metrics {
  steps: number | null
  climbM: number | null
  litRatio: number | null
  unsignalizedCrossings: number | null
  signalCrossings: number | null
  unknownCrossings: number | null
  /** 路線 50 公尺內的監視器數；快照不存在或涵蓋率太低時是 null */
  cameras?: number | null
  /** 路線 150 公尺內的派出所數 */
  policeNearby?: number | null
}

export interface AroundRequest {
  lat: number
  lon: number
  radiusM?: number
  policeRadiusM?: number
}

/** POST /api/around：某一點附近的路燈、監視器、派出所。null 是「沒有資料」，不是 0。 */
export interface AroundResponse {
  radiusM: number
  policeRadiusM: number
  /** cells 是有路燈的約 30 公尺方格數，不是盞數或亮度 */
  lamps: { nearby: boolean; cells: number } | null
  cameras: number | null
  police: { name: string; distanceM: number }[] | null
  sources: { name: string; updatedAt: string | null }[]
}

export interface RouteDiff {
  distanceM: number
  durationS: number
  steps: number | null
  climbM: number | null
  unsignalizedCrossings: number | null
}

export interface Source {
  name: string
  updatedAt: string
}

export interface RouteOption {
  id: string
  recommended: boolean
  reasons: string[]
  distanceM: number
  durationS: number
  geometry: LatLon[]
  maneuvers: Maneuver[]
  /** 階段 1 是 null */
  metrics: Metrics | null
  /** fastest 本身是 null */
  diff: RouteDiff | null
}

export interface RoutesResponse {
  context: { audience: Audience; period: 'day' | 'night'; simulated: boolean }
  routes: RouteOption[]
  notes: string[]
  sources: Source[]
}

export interface RoutesRequest {
  from: { lat: number; lon: number }
  to: { lat: number; lon: number; stationUid?: string }
  audience: Audience
  /** null 表示依規則表算全部；重新規劃時傳目前的候選 id */
  candidate: string | null
  /** null 或 'night'，只用於 Demo */
  simulate: 'night' | null
}

export interface BilingualName {
  zh: string | null
  en: string | null
}

export interface StationRoute {
  routeName: { zh: string; en: string | null }
  /** TDX：0 去程、1 返程、2 迴圈、10 循環、255 未知。畫面顯示 headsign，不要顯示數字 */
  direction: number
  headsign: BilingualName
  stopUid: string
}

export interface Station {
  stationUid: string
  name: { zh: string; en: string | null }
  bearing: string | null
  lat: number
  lon: number
  /** 只有 nearby 才有 */
  distanceM?: number
  routes: StationRoute[]
}

export interface StationsResponse {
  stations: Station[]
  source: Source
}

export interface NearbyRequest {
  lat: number
  lon: number
  radiusM: number
}

/** 感測錯誤碼，見 03 感測段落 */
export type SensorErrorCode =
  | 'location_denied'
  | 'location_off'
  | 'no_heading_sensor'
  | 'sensor_error'
