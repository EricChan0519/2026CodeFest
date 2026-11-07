/**
 * 公車站牌搜尋（實驗頁用）：查 TDX 站位快照，不是 OpenStreetMap。
 * OSM 的站牌名稱常是舊名（例如「啟智學校」），而且沒有路線；TDX 快照有現行站名和每個站位的路線與方向。
 *
 * 快照是 api/data/stop_index.json 的副本（scripts/build_stop_index.py 從 TDX 產生，資料：TDX 公車站位資料），
 * 放在 web/public/lab/stop_index.json，第一次搜尋才下載（約 460 KB gzip）。
 * 正式流程用自己後端的 GET /api/stations/search（api.search），不是這個檔案。
 */
import type { LatLon, Station, StationRoute } from '@/lib/contract'
import type { RoutePattern } from '@/lib/directBus'
import { distanceM } from '@/nav/geo'
import { fuzzyScore, normalizeQuery, parseQuery } from '@/lib/fuzzy'
import { baseName } from '@/lib/placeSearch'
import type { ParsedQuery } from '@/lib/fuzzy'

export { normalizeQuery }

export const STOP_INDEX_URL = '/lab/stop_index.json'

export interface StopIndex {
  updatedAt: string
  stations: Station[]
  /** 每條路線、每個方向的停靠順序，給 planDirectBus 用；舊快照沒有時是空陣列 */
  patterns: RoutePattern[]
  /** 預先算好的小寫、臺／台統一的搜尋字串，和 stations 同一個順序 */
  keys: string[]
}

/** 使用者常會多打「公車站」「站牌」「公車」，這些字不在站名裡，要拿掉再比對 */
const SUFFIXES = ['公車站牌', '公車站', '站牌', '公車']

/** 搜尋用的關鍵字變體：原字串，加上拿掉結尾贅字的版本 */
export function queryVariants(q: string): string[] {
  const base = normalizeQuery(q)
  const out = new Set<string>()
  if (base) out.add(base)
  for (const suf of SUFFIXES) {
    if (base.endsWith(suf) && base.length > suf.length) out.add(base.slice(0, -suf.length))
  }
  return [...out]
}

export function buildStopIndex(data: { updatedAt: string; stations: Station[]; patterns?: RoutePattern[] }): StopIndex {
  return {
    updatedAt: data.updatedAt,
    stations: data.stations,
    patterns: data.patterns ?? [],
    keys: data.stations.map((s) => normalizeQuery(`${s.name.zh} ${s.name.en ?? ''}`)),
  }
}

/** 站名完全相同 3 > 站名開頭相同 2 > 站名包含 1 > 模糊（0–1） */
function score(key: string, zh: string, needles: string[], parsed: ParsedQuery): number {
  let best = 0
  for (const n of needles) {
    if (zh === n) return 3
    if (zh.startsWith(n)) best = Math.max(best, 2)
    else if (key.includes(n)) best = Math.max(best, 1)
  }
  // 對不到時用模糊比對（0–1，見 fuzzy.ts）：「芝山捷運站」也找得到「捷運芝山站」
  return best > 0 ? best : fuzzyScore(parsed, key)
}

/**
 * 站名含關鍵字的站位；同名的不同站位（兩個方向）都列出，不合併。
 * 先比站名像不像（完全相同 > 開頭相同 > 包含），一樣像的依離 near 的距離由近到遠（2026-11-07 回報：沒有照距離排）。
 */
export function searchStops(index: StopIndex, q: string, limit = 20, near: LatLon | null = null): Station[] {
  const needles = queryVariants(q)
  if (needles.length === 0) return []
  const parsed = parseQuery(q)
  const hits: { s: Station; score: number; d: number; i: number }[] = []
  index.stations.forEach((s, i) => {
    const sc = score(index.keys[i]!, normalizeQuery(s.name.zh), needles, parsed)
    if (sc > 0) hits.push({ s, score: sc, d: near ? distanceM(near, [s.lat, s.lon]) : 0, i })
  })
  hits.sort((a, b) => b.score - a.score || a.d - b.d || a.i - b.i)
  return hits.slice(0, limit).map((h) => h.s)
}

/** 同名站牌彼此這麼近就合併成一筆（路口兩側、對向的站牌通常在 100 公尺內） */
export const SAME_STOP_M = 400

/** 合併後的一筆站牌：每條路線記得自己停哪一個站位，導航時帶你走到那一側 */
export interface StopGroup {
  key: string
  name: Station['name']
  /** 列表上算距離用：離 near 最近的那個站位 */
  lat: number
  lon: number
  stations: Station[]
  routes: { route: StationRoute; station: Station }[]
}

const dropBrackets = (s: string) => s.replace(/\s*(?:\(.*?\)|（.*?）)\s*/g, '').trim()

/**
 * 同名而且相距 SAME_STOP_M 以內的站位（兩個方向、路口兩側）合併成一筆（2026-11-08 回報：列表太長、看不出差別）。
 * 括號裡的路名不算（捷運芝山站(福華)、捷運芝山站(福國) 是同一筆「捷運芝山站」）。
 * 路線依「路線＋往哪裡」去重，同一條路線同一方向在好幾個站位都停時，留離 near 最近的。保留 stations 原本的順序。
 */
export function groupStops(stations: Station[], near: LatLon | null): StopGroup[] {
  const d = (s: Station) => (near ? distanceM(near, [s.lat, s.lon]) : 0)
  const groups: Station[][] = []
  for (const s of stations) {
    const key = baseName(s.name.zh)
    const g = groups.find((g) => baseName(g[0]!.name.zh) === key && g.some((m) => distanceM([m.lat, m.lon], [s.lat, s.lon]) <= SAME_STOP_M))
    if (g) g.push(s)
    else groups.push([s])
  }
  return groups.map((g) => {
    const byNear = [...g].sort((a, b) => d(a) - d(b))
    const seen = new Set<string>()
    const routes: StopGroup['routes'] = []
    for (const station of byNear) {
      for (const route of station.routes) {
        const k = `${route.routeName.zh}|${route.headsign.zh ?? ''}`
        if (seen.has(k)) continue
        seen.add(k)
        routes.push({ route, station })
      }
    }
    const first = byNear[0]!
    // 合併了不同括號的站名時，顯示拿掉括號的名稱
    const oneName = g.every((s) => s.name.zh === first.name.zh)
    const name = oneName ? first.name : { zh: dropBrackets(first.name.zh), en: first.name.en ? dropBrackets(first.name.en) : null }
    return { key: g.map((s) => s.stationUid).join('+'), name, lat: first.lat, lon: first.lon, stations: g, routes }
  })
}

let cached: Promise<StopIndex> | null = null

/** 下載並快取站位快照；失敗時下次搜尋會重試 */
export function loadStopIndex(): Promise<StopIndex> {
  if (!cached) {
    cached = fetch(STOP_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`STOPS_HTTP_${res.status}`)
        return res.json() as Promise<{ updatedAt: string; stations: Station[]; patterns?: RoutePattern[] }>
      })
      .then(buildStopIndex)
      .catch((e) => {
        cached = null
        throw e
      })
  }
  return cached
}
