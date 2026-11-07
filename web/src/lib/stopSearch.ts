/**
 * 公車站牌搜尋（實驗頁用）：查 TDX 站位快照，不是 OpenStreetMap。
 * OSM 的站牌名稱常是舊名（例如「啟智學校」），而且沒有路線；TDX 快照有現行站名和每個站位的路線與方向。
 *
 * 快照是 api/data/stop_index.json 的副本（scripts/build_stop_index.py 從 TDX 產生，資料：TDX 公車站位資料），
 * 放在 web/public/lab/stop_index.json，第一次搜尋才下載（約 460 KB gzip）。
 * 正式流程用自己後端的 GET /api/stations/search（api.search），不是這個檔案。
 */
import type { Station } from '@/lib/contract'

export const STOP_INDEX_URL = '/lab/stop_index.json'

export interface StopIndex {
  updatedAt: string
  stations: Station[]
  /** 預先算好的小寫、臺／台統一的搜尋字串，和 stations 同一個順序 */
  keys: string[]
}

/** 臺／台統一、去空白、小寫 */
export function normalizeQuery(s: string): string {
  return s.replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase()
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

export function buildStopIndex(data: { updatedAt: string; stations: Station[] }): StopIndex {
  return {
    updatedAt: data.updatedAt,
    stations: data.stations,
    keys: data.stations.map((s) => normalizeQuery(`${s.name.zh} ${s.name.en ?? ''}`)),
  }
}

/** 站名完全相同 > 站名開頭相同 > 站名包含 */
function score(key: string, zh: string, needles: string[]): number {
  let best = 0
  for (const n of needles) {
    if (zh === n) return 3
    if (zh.startsWith(n)) best = Math.max(best, 2)
    else if (key.includes(n)) best = Math.max(best, 1)
  }
  return best
}

/** 站名含關鍵字的站位；同名的不同站位（兩個方向）都列出，不合併 */
export function searchStops(index: StopIndex, q: string, limit = 20): Station[] {
  const needles = queryVariants(q)
  if (needles.length === 0) return []
  const hits: { s: Station; score: number; i: number }[] = []
  index.stations.forEach((s, i) => {
    const sc = score(index.keys[i]!, normalizeQuery(s.name.zh), needles)
    if (sc > 0) hits.push({ s, score: sc, i })
  })
  hits.sort((a, b) => b.score - a.score || a.i - b.i)
  return hits.slice(0, limit).map((h) => h.s)
}

let cached: Promise<StopIndex> | null = null

/** 下載並快取站位快照；失敗時下次搜尋會重試 */
export function loadStopIndex(): Promise<StopIndex> {
  if (!cached) {
    cached = fetch(STOP_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`STOPS_HTTP_${res.status}`)
        return res.json() as Promise<{ updatedAt: string; stations: Station[] }>
      })
      .then(buildStopIndex)
      .catch((e) => {
        cached = null
        throw e
      })
  }
  return cached
}
