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
/** 拿掉括號、出口之後名稱一樣、這麼近就當作同一個地點（「捷運大直站(1號出口)」與「捷運大直站」） */
export const SAME_BASE_M = 300
/** 同一個車站的各種寫法（站牌、出口、候車區）彼此這麼近就合併成一筆 */
export const SAME_STATION_M = 600
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

/** 名稱拿掉括號（分店、方向、品牌）和出口編號：「捷運芝山站 (福華)」→ 捷運芝山站 */
export function baseName(name: string): string {
  return normalizePoi(name.replace(/\(.*?\)|（.*?）|【.*?】|\[.*?\]/g, '')).replace(/[0-9一二三四五六七八九十]*號?出口\d*$/, '')
}

function samePlace(a: PlaceHit, b: PlaceHit): boolean {
  const na = normalizePoi(a.name)
  const nb = normalizePoi(b.name)
  const d = distanceM(a.point, b.point)
  if (na === nb) return d <= SAME_NAME_M
  const ba = baseName(a.name)
  if (ba.length >= 2 && ba === baseName(b.name) && d <= SAME_BASE_M) return true
  return d <= SAME_PLACE_M && na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))
}

/**
 * 名稱裡提到的車站叫什麼（拿掉 公車／捷運／臺鐵／路線名／括號）；沒有提到車站回 null。
 * 公車捷運芝山站（福華）、捷運淡水線-芝山站、捷運芝山站 夜間婦女候車區 → 芝山；芝山捷運橋下公園 → null
 */
export function stationCore(name: string): string | null {
  const s = normalizeQuery(name.replace(/\(.*?\)|（.*?）|【.*?】|\[.*?\]/g, ''))
  const m = s.match(/^(.+?)車?站/)
  if (!m) return null
  const core = m[1]!
    .replace(/^.*[-－–—「」]/, '')
    .replace(/^.*線/, '')
    .replace(/^(?:臺北|公車|客運|捷運|臺鐵|高鐵|mrt)+/, '')
    .replace(/(?:捷運|mrt)$/, '')
  return core.length >= 2 ? core : null
}

/** 搜尋字串是不是在找某個車站，是的話回傳站名（芝山捷運站、捷運芝山站、芝山站 → 芝山） */
export function stationQuery(q: string): string | null {
  const qn = normalizePoi(q)
  if (!STATION_WORDS.test(qn)) return null
  return stationCore(qn) ?? stationCore(`${qn}站`)
}

/**
 * 搜尋字串有「捷運」「站」這類種類字時，拿掉之後剩下的地名（芝山）一定要出現在名稱或地址裡。
 * 不然後端的錯字容忍和 Nominatim 會把「芝山捷運站」配到圓山、中山、大直捷運站（2026-11-07、11-08 回報）。
 * 路名、地址這種沒有種類字的搜尋不過濾。「臺北車站」的核心是「臺北車」，比對時拿掉「車」（臺北火車站也算）。
 */
export function mentionsCore(q: string, text: string): boolean {
  const parsed = parseQuery(q)
  if (!parsed.core || parsed.core === parsed.full || parsed.core.length < 2) return true
  const core = parsed.core.length > 2 ? parsed.core.replace(/車$/, '') : parsed.core
  return normalizeQuery(text).includes(core)
}

/** 幾個點中間的那一個（離其他點距離總和最小）：合併後導航到這裡，一定是真的有的點 */
function medoid(ps: PlaceHit[]): PlaceHit {
  let best = ps[0]!
  let bestSum = Infinity
  for (const a of ps) {
    const sum = ps.reduce((t, b) => t + distanceM(a.point, b.point), 0)
    if (sum < bestSum) [best, bestSum] = [a, sum]
  }
  return best
}

/**
 * 找車站時，同一站的站牌、出口、候車區（公車捷運芝山站（福華）、捷運芝山站(福國)、捷運淡水線-芝山站…）
 * 合併成一筆「捷運芝山站」（2026-11-08 回報：一個站列了六筆）。彼此相距 SAME_STATION_M 以內的才算同一站。
 */
function mergeStation(q: string, kept: PlaceHit[]): PlaceHit[] {
  const core = stationQuery(q)
  if (!core) return kept
  const isMember = (p: PlaceHit) => stationCore(p.name) === core
  const clusters: PlaceHit[][] = []
  for (const p of kept.filter(isMember)) {
    const c = clusters.find((c) => c.some((m) => distanceM(m.point, p.point) <= SAME_STATION_M))
    if (c) c.push(p)
    else clusters.push([p])
  }
  if (clusters.every((c) => c.length === 1)) return kept
  const mrt = /捷運|mrt/.test(normalizePoi(q))
  // 每一站的第一筆換成合併後的那一筆，其餘的拿掉
  const replace = new Map<PlaceHit, PlaceHit | null>()
  for (const c of clusters) {
    if (c.length === 1) continue
    const at = medoid(c)
    const shortest = c.reduce((a, b) => (baseName(b.name).length < baseName(a.name).length ? b : a))
    const name = mrt || c.some((m) => /捷運|mrt/i.test(m.name)) ? `捷運${core}站` : shortest.name
    replace.set(c[0]!, { ...at, name, detail: '', category: '交通', address: null })
    for (const m of c.slice(1)) replace.set(m, null)
  }
  return kept.flatMap((p) => {
    const r = replace.get(p)
    return r === undefined ? [p] : r ? [r] : []
  })
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
 * 名稱和地址都沒提到搜尋的地名的不要（mentionsCore）；找車站時同一站的各種寫法合併成一筆（mergeStation）。
 * 排序：相關程度（relevance）一樣的才依距離，名稱只是順便提到的不會因為比較近就排到前面。
 * @param near 參考點（使用者位置，拿不到時用臺北車站）；null 時保留原本順序
 */
export function mergePlaces(q: string, lists: PlaceHit[][], near: LatLon | null, limit = 30): PlaceHit[] {
  const kept: PlaceHit[] = []
  for (const list of lists) {
    for (const p of list) {
      if (!mentionsCore(q, `${p.name}${p.address ?? ''}`)) continue
      if (kept.some((k) => samePlace(k, p))) continue
      kept.push(p)
    }
  }
  const all = mergeStation(q, kept).map((p) => ({ ...p, distanceM: near ? distanceM(near, p.point) : null }))
  // 太遠的（例如臺中、高雄同名的「中山站」）不管名稱多像都排最後
  const far = (p: PlaceHit) => (p.distanceM !== null && p.distanceM > FAR_M ? 10 : 0)
  const order = all.map((p, i) => ({ p, i, r: relevance(q, p) + far(p) }))
  order.sort((a, b) => a.r - b.r || (near ? a.p.distanceM! - b.p.distanceM! : 0) || a.i - b.i)
  return order.slice(0, limit).map((o) => o.p)
}

/** 查自己後端的地標快照；後端沒開或逾時就丟錯，畫面只顯示 OSM 的結果 */
export async function searchLandmarks(q: string, near: LatLon | null, limit = 20): Promise<PlaceHit[]> {
  const body = near ? { q, lat: near[0], lon: near[1], limit } : { q, limit }
  const res = await api.landmarks(body)
  return res.places.map(fromLandmark)
}

/** OSM（Nominatim）的結果和搜尋字串有沒有關係（mentionsCore；名稱加上 detail 那一串） */
export function osmMatches(q: string, p: Place): boolean {
  return mentionsCore(q, `${p.name}${p.detail}`)
}
