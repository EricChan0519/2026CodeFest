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
import { normalizeQuery, parseQuery } from '@/lib/fuzzy'
import { distanceM } from '@/nav/geo'

export interface PlaceHit extends Place {
  /** 離參考點的直線距離（公尺）；沒有參考點時是 null */
  distanceM: number | null
  /** 中文類別（只有 Overture 的有） */
  category: string | null
  /** 地址（Overture 的地址；OSM 是 detail 那一串） */
  address: string | null
  source: 'overture' | 'osm'
}

/** 同名、這麼近就當作同一個地點 */
export const SAME_NAME_M = 150
/** 名稱互相包含、這麼近也當作同一個地點（「天母運動公園」與「臺北市天母運動公園」） */
export const SAME_PLACE_M = 40
/** 離參考點超過這個距離的結果排到最後（服務範圍是大臺北） */
export const FAR_M = 30_000
/** 搜尋字串至少這麼長，名稱完全一樣的才排最前面 */
export const EXACT_FIRST_MIN_LEN = 4

export function fromLandmark(p: PlaceSearchItem): PlaceHit {
  return {
    name: p.name,
    detail: [p.category, p.address].filter(Boolean).join('・'),
    point: [p.lat, p.lon],
    distanceM: p.distanceM,
    category: p.category,
    address: p.address,
    source: 'overture',
  }
}

export function fromOsm(p: Place): PlaceHit {
  return { ...p, distanceM: null, category: null, address: p.detail || null, source: 'osm' }
}

function samePlace(a: PlaceHit, b: PlaceHit): boolean {
  const na = normalizePoi(a.name)
  const nb = normalizePoi(b.name)
  const d = distanceM(a.point, b.point)
  if (na === nb) return d <= SAME_NAME_M
  return d <= SAME_PLACE_M && na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))
}

// 排序用：把交通系統、出口、括號這些包裝拿掉，剩下的就是「這個地點本身」（台北捷運士林站 → 士林）；和後端 places.py 同一套
const WRAPPER =
  /\(.*?\)|（.*?）|[-－–—].*$|臺北捷運|台北捷運|捷運|臺鐵|台鐵|高鐵|公車|客運|mrt|tra|station|(?:淡水信義|松山新店|中和新蘆|文湖|板南|環狀|機場)線|[0-9一二三四五六七八九十]*號?出口\d*|車站|站/g
const STATION_WORDS = /站|捷運|mrt/
const TRANSPORT_CATEGORIES = new Set(['車站', '捷運站', '公車站', '交通'])

const coreOf = (key: string) => key.replace(WRAPPER, '')

/** 捷運站的說法都算同一個：芝山捷運站 ＝ 捷運芝山站 ＝ 芝山站 */
function queryVariants(qn: string): string[] {
  const out = [qn]
  const m = qn.match(/^(.+?)(?:捷運站|捷運|mrt站|mrt)$/) ?? qn.match(/^(?:捷運|mrt)(.+?)站?$/)
  if (m) out.push(`捷運${m[1]}站`, `${m[1]}站`)
  return out
}

/**
 * 相關程度（小的在前）。只有夠具體的搜尋（4 字以上或像「士林站」的站名）才分層，通稱（公園、體育館）一律 0、依距離。
 * 1：地點本身（名稱一樣，或拿掉 捷運／公車／站／出口／括號 後一樣）
 * 2：交通類（車站、公車站）而且名稱包含搜尋字串
 * 3：搜尋字串占名稱一半以上
 * 4：名稱只是順便提到（「接睫毛/民權西路站/…/士林站」，2026-11-07 回報排在最前面）
 */
export function relevance(q: string, p: Pick<PlaceHit, 'name' | 'category'>): number {
  const qn = normalizePoi(q)
  if (!(qn.length >= EXACT_FIRST_MIN_LEN || STATION_WORDS.test(qn))) return 0
  const variants = queryVariants(qn)
  const cores = new Set(variants.map(coreOf).filter(Boolean))
  const k = normalizePoi(p.name)
  // 拿掉包裝要在去掉連字號之前做（「捷運士林站 - 中正」的「- 中正」是方位）
  if (variants.includes(k) || cores.has(coreOf(normalizeQuery(p.name)))) return 1
  const hit = variants.filter((v) => k.includes(v))
  if (hit.length === 0) return 5
  if (STATION_WORDS.test(qn) && p.category && TRANSPORT_CATEGORIES.has(p.category)) return 2
  if (Math.max(...hit.map((v) => v.length)) >= k.length * 0.5) return 3
  return 4
}

/**
 * 合併、去重、排序。先放的來源優先保留（地標有類別，放前面）。
 * 排序：相關程度（relevance）一樣的才依距離，名稱只是順便提到的不會因為比較近就排到前面。
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
  // 太遠的（例如臺中、高雄同名的「中山站」）不管名稱多像都排最後
  const far = (p: PlaceHit) => (p.distanceM !== null && p.distanceM > FAR_M ? 10 : 0)
  const order = kept.map((p, i) => ({ p, i, r: relevance(q, p) + far(p) }))
  order.sort((a, b) => a.r - b.r || (near ? a.p.distanceM! - b.p.distanceM! : 0) || a.i - b.i)
  return order.slice(0, limit).map((o) => o.p)
}

/** 查自己後端的地標快照；後端沒開或逾時就丟錯，畫面只顯示 OSM 的結果 */
export async function searchLandmarks(q: string, near: LatLon | null, limit = 20): Promise<PlaceHit[]> {
  const body = near ? { q, lat: near[0], lon: near[1], limit } : { q, limit }
  const res = await api.landmarks(body)
  return res.places.map(fromLandmark)
}

/**
 * OSM（Nominatim）的結果和搜尋字串有沒有關係：搜尋字串有「捷運」「站」這類種類字時，
 * 拿掉之後剩下的地名（芝山）一定要出現在名稱裡；不然 Nominatim 會把「芝山捷運站」配到圓山、大直捷運站
 * （2026-11-07 回報）。路名、地址這種沒有種類字的搜尋不過濾。
 */
export function osmMatches(q: string, p: Place): boolean {
  const parsed = parseQuery(q)
  if (!parsed.core || parsed.core === parsed.full || parsed.core.length < 2) return true
  return normalizeQuery(`${p.name}${p.detail}`).includes(parsed.core)
}
