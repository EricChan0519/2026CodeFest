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

/**
 * 實驗頁的預設目的地：市立臺北特教學校公車站。
 *
 * OSM 上這個站還叫舊名「啟智學校」（英文 Taipei School of Special Education），
 * 在忠誠路二段上，兩個方向各一個站位，相距約 40 公尺。
 * 座標來自 OpenStreetMap（node 2459681636、2460552097），要到現場確認站牌名稱與方向。
 *
 * station／stationRoute 是**實驗用的示範資料**，不是 TDX 站位資料：
 * 用來在 /lab/nav 走到站後測 /arrived 的跳頁、語音與卡片。正式流程由 destinationFromStation() 帶入真的資料。
 */
export const DEFAULT_DESTINATION: Destination = {
  name: '市立臺北特教學校（公車站）',
  points: [
    [25.117252, 121.5346766], // OSM 2459681636
    [25.1172611, 121.5342664], // OSM 2460552097
  ],
  station: {
    stationUid: 'LAB-DEMO',
    name: { zh: '市立臺北特教學校', en: 'Taipei School of Special Education' },
    bearing: null,
    lat: 25.117252,
    lon: 121.5346766,
    routes: [],
  },
  stationRoute: {
    routeName: { zh: '307', en: '307' },
    direction: 0,
    headsign: { zh: '往板橋', en: 'To Banqiao' },
    stopUid: 'LAB-DEMO',
  },
}

/** 離使用者最近的站位；不知道要搭哪個方向時用最近的 */
export function nearestPoint(d: Destination, from: LatLon): LatLon {
  return d.points.reduce((best, p) => (distanceM(from, p) < distanceM(from, best) ? p : best))
}
