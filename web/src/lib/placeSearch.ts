/**
 * 「地點與地址」搜尋結果：合併兩個來源，依離使用者的距離由近到遠排。
 * - 地標、餐廳、學校…：自己後端 POST /api/landmarks/search（Overture Maps Places 快照）。
 *   OSM 缺很多地點（2026-11-07 回報「台北市立大學天母體育館」查不到），所以補這個來源。
 * - 路名、地址：OpenStreetMap Nominatim（geocode.ts）。
 * 同一個地點兩邊都有時只留一筆。一律依距離排；只有搜尋字串夠具體（例如「中正紀念堂」）時，
 * 名稱完全一樣的排最前面。「體育館」「公園」這種通稱不這樣做，否則遠處剛好叫「體育館」的地點會排到最前面。
 */
import { api } from '@/lib/api'
import type { LatLon, PlaceSearchItem } from '@/lib/contract'
import type { Place } from '@/lib/geocode'
import { normalizePoi } from '@/lib/poiSearch'
import { distanceM } from '@/nav/geo'

export interface PlaceHit extends Place {
  /** 離參考點的直線距離（公尺）；沒有參考點時是 null */
  distanceM: number | null
  /** 中文類別（只有 Overture 的有） */
  category: string | null
  source: 'overture' | 'osm'
}

/** 同名、這麼近就當作同一個地點 */
export const SAME_NAME_M = 150
/** 名稱互相包含、這麼近也當作同一個地點（「天母運動公園」與「臺北市天母運動公園」） */
export const SAME_PLACE_M = 40
/** 搜尋字串至少這麼長，名稱完全一樣的才排最前面 */
export const EXACT_FIRST_MIN_LEN = 4

export function fromLandmark(p: PlaceSearchItem): PlaceHit {
  return {
    name: p.name,
    detail: [p.category, p.address].filter(Boolean).join('・'),
    point: [p.lat, p.lon],
    distanceM: p.distanceM,
    category: p.category,
    source: 'overture',
  }
}

export function fromOsm(p: Place): PlaceHit {
  return { ...p, distanceM: null, category: null, source: 'osm' }
}

function samePlace(a: PlaceHit, b: PlaceHit): boolean {
  const na = normalizePoi(a.name)
  const nb = normalizePoi(b.name)
  const d = distanceM(a.point, b.point)
  if (na === nb) return d <= SAME_NAME_M
  return d <= SAME_PLACE_M && na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))
}

/**
 * 合併、去重、排序。先放的來源優先保留（地標有類別，放前面）。
 * @param near 參考點（使用者位置，拿不到時用臺北車站）；null 時保留原本順序
 */
export function mergePlaces(q: string, lists: PlaceHit[][], near: LatLon | null, limit = 30): PlaceHit[] {
  const kept: PlaceHit[] = []
  for (const list of lists) {
    for (const p of list) {
      if (kept.some((k) => samePlace(k, p))) continue
      kept.push({ ...p, distanceM: near ? distanceM(near, p.point) : null })
    }
  }
  const qn = normalizePoi(q)
  const exactFirst = qn.length >= EXACT_FIRST_MIN_LEN
  const exact = (p: PlaceHit) => (exactFirst && normalizePoi(p.name) === qn ? 0 : 1)
  const order = kept.map((p, i) => ({ p, i }))
  order.sort((a, b) => exact(a.p) - exact(b.p) || (near ? a.p.distanceM! - b.p.distanceM! : 0) || a.i - b.i)
  return order.slice(0, limit).map((o) => o.p)
}

/** 查自己後端的地標快照；後端沒開或逾時就丟錯，畫面只顯示 OSM 的結果 */
export async function searchLandmarks(q: string, near: LatLon | null, limit = 20): Promise<PlaceHit[]> {
  const body = near ? { q, lat: near[0], lon: near[1], limit } : { q, limit }
  const res = await api.landmarks(body)
  return res.places.map(fromLandmark)
}
