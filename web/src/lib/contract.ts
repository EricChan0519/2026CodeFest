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
  /** 過馬路（前端由 Valhalla trace_attributes 補上，見 lib/walkRoute.ts 的 applyCrossings） */
  | 'cross'

export interface Maneuver {
  kind: ManeuverKind
  /** cross：馬路對面（過完的地方）；其他：轉彎點 */
  atIndex: number
  distanceToNextM: number
  street: string | null
  /** cross 才有：開始過馬路的地方（斑馬線起點） */
  fromIndex?: number
  /** cross 才有：過完馬路接著要轉的方向，例如 right＝「過完馬路再右轉」；直走是 null */
  then?: ManeuverKind | null
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

/** POST /api/landmarks/search：地標、餐廳、學校…（Overture Maps Places 快照，不含連鎖店） */
export interface PlaceSearchRequest {
  q: string
  /** 使用者位置，只用來依距離排序；放 body 不放網址（ADR-0005） */
  lat?: number
  lon?: number
  limit?: number
}

export interface PlaceSearchItem {
  name: string
  lat: number
  lon: number
  address: string | null
  /** 中文類別，例如「餐廳」「國小」「運動場館」 */
  category: string
  /** 有給位置才有 */
  distanceM: number | null
}

export interface PlaceSearchResponse {
  places: PlaceSearchItem[]
  source: { name: string; release: string | null; license: string | null; updatedAt: string | null }
}

/** 外語地點搜尋支援的語言（中文以外） */
export type ForeignLang = 'en' | 'id' | 'vi' | 'th' | 'km' | 'ko' | 'ja'

/** POST /api/translate/query：外語搜尋字串 → 中文（規則＋開放資料，不用 AI 模型） */
export interface TranslateQueryResponse {
  /** 判斷出來的語言；中文是 'zh' */
  lang: ForeignLang | 'zh'
  /** 中文搜尋字串，最可能的在前；翻不出來是空陣列 */
  queries: string[]
  /** 有看不懂、略過的部分 */
  partial: boolean
  segments: { text: string; kind: 'prefix' | 'proper' | 'head' | 'unknown'; zh: string[]; via: string }[]
}

/** POST /api/translate/names：中文地名 → 使用者的語言；拆不出來的不翻（text 為 null），只給讀音 */
export interface LocalizedName {
  zh: string
  text: string | null
  reading: string | null
}

export interface TranslateNamesResponse {
  lang: ForeignLang
  names: LocalizedName[]
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
