/**
 * 導航的目的地：站位座標，加上站點 API 的 Station 和使用者選的那筆 StationRoute。
 * 導航要記住「要等哪一班車」，到站時才能把站名、路線、方向交給 /arrived（見 arrival/arrival.ts）。
 */
import type { LatLon, Station, StationRoute } from '@/lib/contract'
import { distanceM } from './geo'

export interface Destination {
  name: string
  /** 站位，每個方向一個 */
  points: LatLon[]
  /** 站點 API（/api/stations/*）回的站位；到站畫面要用站名 */
  station?: Station
  /** 使用者在 P4 選的那筆路線和方向 */
  stationRoute?: StationRoute
}

/** 正式流程：P4 選好站位和那班車後，用這個建導航目的地。座標只用在導航，不會進網址 */
export function destinationFromStation(station: Station, stationRoute: StationRoute): Destination {
  return {
    name: station.name.zh,
    points: [[station.lat, station.lon]],
    station,
    stationRoute,
  }
}

/** 實驗頁：使用者自己輸入的地址或地標。沒有站牌資料，到達時只顯示「到了」，不會跳到 /arrived */
export function destinationFromPlace(place: { name: string; point: LatLon }): Destination {
  return { name: place.name, points: [place.point] }
}

/**
 * 實驗頁的預設目的地：市立臺北特教學校公車站，往天母的 203（北側站位）。
 *
 * 資料來自 TDX 站位快照（web/public/lab/stop_index.json，站位 TPE789、路線 203、stopUid TPE12786），
 * 不是編的。OSM 上這個站還叫舊名「啟智學校」，所以站牌用 TDX 的資料，不用地址搜尋。
 * 兩個方向各一個站位，相距約 40 公尺；要到現場確認站牌名稱與方向。
 */
export const DEFAULT_DESTINATION: Destination = destinationFromStation(
  {
    stationUid: 'TPE789',
    name: { zh: '市立臺北特教學校', en: 'Taipei Municipal School of Special Education' },
    bearing: 'N',
    lat: 25.11733,
    lon: 121.534693,
    routes: [],
  },
  {
    routeName: { zh: '203', en: '203' },
    direction: 0,
    headsign: { zh: '往天母', en: 'To Tianmu' },
    stopUid: 'TPE12786',
  },
)

/** 離使用者最近的站位；不知道要搭哪個方向時用最近的 */
export function nearestPoint(d: Destination, from: LatLon): LatLon {
  return d.points.reduce((best, p) => (distanceM(from, p) < distanceM(from, best) ? p : best))
}
