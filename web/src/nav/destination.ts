/**
 * 實驗頁的預設目的地：市立臺北特教學校公車站。
 *
 * OSM 上這個站還叫舊名「啟智學校」（英文 Taipei School of Special Education），
 * 在忠誠路二段上，兩個方向各一個站位，相距約 40 公尺。
 * 座標來自 OpenStreetMap（node 2459681636、2460552097），要到現場確認站牌名稱與方向。
 */
import type { LatLon } from '@/lib/contract'
import { distanceM } from './geo'

export interface Destination {
  name: string
  /** 站位，每個方向一個 */
  points: LatLon[]
}

export const DEFAULT_DESTINATION: Destination = {
  name: '市立臺北特教學校（公車站）',
  points: [
    [25.117252, 121.5346766], // OSM 2459681636
    [25.1172611, 121.5342664], // OSM 2460552097
  ],
}

/** 離使用者最近的站位；不知道要搭哪個方向時用最近的 */
export function nearestPoint(d: Destination, from: LatLon): LatLon {
  return d.points.reduce((best, p) => (distanceM(from, p) < distanceM(from, best) ? p : best))
}

export interface DestinationLock {
  /** 第一次呼叫時選最近的站位並鎖定；之後（含重新規劃）一律回傳同一個 */
  pick(from: LatLon): LatLon
  /** 已鎖定的站位，還沒選時為 null */
  readonly point: LatLon | null
  /** 開始新的一趟時呼叫 */
  reset(): void
}

/**
 * 目的地一趟只選一次。重算時若用「目前位置」重新選最近站位，
 * 走到馬路另一側就會跳到對面站牌，新路線要人過馬路，箭頭會往旁邊指（2026-11-07 實測）。
 */
export function createDestinationLock(d: Destination): DestinationLock {
  let locked: LatLon | null = null
  return {
    pick(from) {
      locked ??= nearestPoint(d, from)
      return locked
    },
    get point() {
      return locked
    },
    reset() {
      locked = null
    },
  }
}
