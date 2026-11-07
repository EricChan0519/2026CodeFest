/**
 * 連鎖店搜尋（實驗頁用）：便利商店（7-11、全家、萊爾富、OK）、速食與連鎖餐廳（麥當勞、肯德基、漢堡王、海底撈…）、咖啡飲料。
 *
 * 資料：Overture Maps Places（免費、免金鑰、CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0，不含 OpenStreetMap）。
 * 由 scripts/build_poi_index.py 預先篩出台灣的連鎖品牌，存成 web/public/lab/poi_index.json（約 1.7 MB、gzip 後約 0.5 MB），
 * 第一次搜尋才下載，之後都在本機比對，不會把使用者輸入送到第三方。
 * 為什麼不用 Nominatim：OSM 的連鎖店在台灣不齊（同一個品牌常常只有個位數），而且一次只回幾筆，沒辦法「找最近的那家」。
 */
import type { LatLon } from '@/lib/contract'
import { distanceM } from '@/nav/geo'
import { normalizeQuery } from '@/lib/stopSearch'

export const POI_INDEX_URL = '/lab/poi_index.json'

export type PoiKind = 'store' | 'food' | 'cafe'

export interface PoiBrand {
  key: string
  zh: string
  en: string
  kind: PoiKind
  aliases: string[]
}

export interface Poi {
  brand: PoiBrand
  name: string
  point: LatLon
  address: string
  /** 0–100，來源資料對「這家店真的存在」的信心 */
  confidence: number
}

export interface PoiHit extends Poi {
  /** 離參考點的直線距離（公尺）；沒給參考點就是 null */
  distanceM: number | null
}

export interface PoiFile {
  release: string
  updatedAt: string
  source?: string
  license?: string
  brands: PoiBrand[]
  /** [品牌索引, 店名, 緯度, 經度, 地址, 信心 0–100] */
  places: [number, string, number, number, string, number][]
}

export interface PoiIndex {
  release: string
  updatedAt: string
  places: Poi[]
  /** 和 places 同一個順序：店名、地址的正規化字串 */
  nameKeys: string[]
  addrKeys: string[]
  /** 品牌的別名（正規化後），用來辨認「搜尋字串裡有沒有品牌」 */
  aliasList: { brand: PoiBrand; alias: string }[]
}

/** 臺／台統一、去空白、小寫，再拿掉連字號與撇號（7-11 ≈ 711、McDonald's ≈ mcdonalds） */
export function normalizePoi(s: string): string {
  return normalizeQuery(s).replace(/['’‘`\-_.・·]/g, '')
}

export function buildPoiIndex(data: PoiFile): PoiIndex {
  const places: Poi[] = []
  for (const [bi, name, lat, lon, address, confidence] of data.places) {
    const brand = data.brands[bi]
    if (!brand) continue
    places.push({ brand, name, point: [lat, lon], address, confidence })
  }
  const aliasList: PoiIndex['aliasList'] = []
  for (const brand of data.brands) {
    const seen = new Set<string>()
    for (const a of [brand.key, brand.zh, brand.en, ...brand.aliases]) {
      const n = normalizePoi(a)
      // 單一個字太容易誤判（例如「ok」以外的單字母）
      if (n.length >= 2 && !seen.has(n)) {
        seen.add(n)
        aliasList.push({ brand, alias: n })
      }
    }
  }
  return {
    release: data.release,
    updatedAt: data.updatedAt,
    places,
    nameKeys: places.map((p) => normalizePoi(p.name)),
    addrKeys: places.map((p) => normalizePoi(p.address)),
    aliasList,
  }
}

export interface PoiSearchOptions {
  /** 參考點：結果依離這裡的距離由近到遠排；沒給就依信心高到低 */
  near?: LatLon | null
  limit?: number
}

/**
 * 搜尋規則：
 * 1. 搜尋字串裡有品牌別名（「海底撈」「麥當勞 信義」「7-11」「kfc」）→ 列出該品牌的所有分店；
 *    別名以外剩下的字（「信義」）要出現在店名或地址裡。
 * 2. 沒有品牌 → 店名包含搜尋字串的連鎖店（例如「星」→ 不會亂配，至少 2 個字才比對）。
 * 結果依距離排序，所以「找最近的全家」就是輸入「全家」。
 */
export function searchPois(index: PoiIndex, q: string, opts: PoiSearchOptions = {}): PoiHit[] {
  const { near = null, limit = 20 } = opts
  const qn = normalizePoi(q)
  if (qn.length < 2 && !index.aliasList.some((a) => a.alias === qn)) return []

  const brandKeys = new Set<string>()
  let matchedAlias = ''
  // 英文品牌名還沒打完（「mcdonald」「starbuck」）：別名以搜尋字串開頭，整個字串就是品牌，不再拆「剩下的字」
  if (qn.length >= 3) {
    for (const { brand, alias } of index.aliasList) if (alias.startsWith(qn)) brandKeys.add(brand.key)
  }
  // 否則找搜尋字串裡最長的別名；同樣長的品牌都算（例如「手搖」同時是好幾個品牌）
  if (brandKeys.size === 0) {
    let maxLen = 0
    for (const { alias } of index.aliasList) if (qn.includes(alias)) maxLen = Math.max(maxLen, alias.length)
    if (maxLen > 0) {
      for (const { brand, alias } of index.aliasList) {
        if (alias.length === maxLen && qn.includes(alias)) {
          brandKeys.add(brand.key)
          matchedAlias = alias
        }
      }
    }
  }
  const rest = matchedAlias ? qn.replace(matchedAlias, '') : ''

  const hits: PoiHit[] = []
  index.places.forEach((p, i) => {
    const nameKey = index.nameKeys[i]!
    const addrKey = index.addrKeys[i]!
    if (brandKeys.size > 0) {
      if (!brandKeys.has(p.brand.key)) return
      if (rest && !nameKey.includes(rest) && !addrKey.includes(rest)) return
    } else if (!nameKey.includes(qn)) {
      return
    }
    hits.push({ ...p, distanceM: near ? distanceM(near, p.point) : null })
  })

  hits.sort((a, b) =>
    near ? (a.distanceM ?? 0) - (b.distanceM ?? 0) : b.confidence - a.confidence || a.name.localeCompare(b.name, 'zh-Hant'),
  )
  return hits.slice(0, limit)
}

/** 把距離說成「350 公尺」「2.4 公里」 */
export function formatDistance(m: number | null): string {
  if (m === null) return ''
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} 公尺`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`
}

let cached: Promise<PoiIndex> | null = null

/** 下載並快取連鎖店快照；失敗時下次搜尋會重試 */
export function loadPoiIndex(): Promise<PoiIndex> {
  if (!cached) {
    cached = fetch(POI_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`POI_HTTP_${res.status}`)
        return res.json() as Promise<PoiFile>
      })
      .then(buildPoiIndex)
      .catch((e) => {
        cached = null
        throw e
      })
  }
  return cached
}
