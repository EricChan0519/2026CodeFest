/**
 * 地址／地標 → 座標（實驗頁用）：呼叫 OpenStreetMap 的 Nominatim（OSM 資料，ODbL）。
 * 也接受直接輸入座標「25.1172, 121.5346」。
 *
 * 注意：
 * - 這會把使用者輸入的地址送到第三方伺服器，正式版要走自己的後端（ADR-0005）。
 * - 公開的 Nominatim 規定：只能在使用者按下搜尋時查（不能邊打邊查）、每秒最多一次。
 * - OSM 在臺灣的「門牌號碼」資料不完整，查不到門牌時請改輸入路名、地標或社區名稱。
 */
import type { LatLon } from '@/lib/contract'

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

export interface Place {
  /** 名稱，例如「臺北車站」「忠誠路二段」 */
  name: string
  /** 補充說明（門牌、行政區…） */
  detail: string
  point: LatLon
}

interface NominatimRow {
  lat: string
  lon: string
  name?: string
  display_name: string
}

/** 「25.1172, 121.5346」或「25.1172 121.5346」；範圍限定在臺灣一帶，避免經緯度寫反 */
export function parseCoordinates(q: string): LatLon | null {
  const m = q.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,，\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (lat < 20 || lat > 27 || lon < 117 || lon > 123) return null
  return [lat, lon]
}

export function parseNominatim(rows: NominatimRow[]): Place[] {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const r of rows) {
    const lat = Number(r.lat)
    const lon = Number(r.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const parts = r.display_name.split(',').map((s) => s.trim())
    const name = r.name?.trim() || parts[0] || r.display_name
    const detail = parts.filter((p) => p !== name).join('，')
    const key = `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, detail, point: [lat, lon] })
  }
  return out
}

/**
 * 捷運站的另一種說法，給 Nominatim 查不到時重試一次：
 * 「芝山捷運站」「捷運 芝山」「芝山 MRT」→「捷運芝山站」；本來就是「捷運芝山站」→「芝山站」。
 * 不是捷運站的說法回 null。
 */
export function mrtAlternative(q: string): string | null {
  const s = q.trim().replace(/\s+/g, '')
  const canonical = s.match(/^捷運(.+?)站$/)
  if (canonical) return `${canonical[1]}站`
  const m = s.match(/^(.+?)捷運站?$/) ?? s.match(/^捷運(.+?)$/) ?? s.match(/^(.+?)(?:站)?mrt(?:station)?$/i)
  const name = m?.[1]?.replace(/站$/, '')
  return name ? `捷運${name}站` : null
}

/** 大臺北：lon 121.40–121.70、lat 24.95–25.22（Nominatim viewbox 格式：左,上,右,下） */
export const GREATER_TAIPEI_VIEWBOX = '121.40,25.22,121.70,24.95'

/** 公開 Nominatim 每秒最多一次 */
const NOMINATIM_GAP_MS = 1100

async function queryNominatim(query: string, limit: number, signal: AbortSignal): Promise<Place[]> {
  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('countrycodes', 'tw')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('accept-language', 'zh-TW')
  // 只查大臺北（和後端地點快照同一個範圍）：「中山站」不要跑出臺中、高雄的中山站（2026-11-07 回報）
  url.searchParams.set('viewbox', GREATER_TAIPEI_VIEWBOX)
  url.searchParams.set('bounded', '1')
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`GEOCODE_HTTP_${res.status}`)
  return parseNominatim((await res.json()) as NominatimRow[])
}

export async function searchPlaces(q: string, opts: { timeoutMs?: number; limit?: number } = {}): Promise<Place[]> {
  const query = q.trim()
  if (!query) return []
  const coords = parseCoordinates(query)
  if (coords) return [{ name: '輸入的座標', detail: `${coords[0]}, ${coords[1]}`, point: coords }]

  const { timeoutMs = 10000, limit = 5 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // 「芝山捷運站」這種說法，Nominatim 會模糊配到別的捷運站（圓山、大直）：先用標準寫法「捷運芝山站」查
    const alt = mrtAlternative(query)
    const canonicalFirst = alt !== null && !/^捷運.+站$/.test(query.replace(/\s+/g, ''))
    const first = await queryNominatim(canonicalFirst ? alt : query, limit, ctrl.signal)
    const second = canonicalFirst ? query : alt
    if (first.length > 0 || !second) return first
    // 查不到再換個說法查一次（只多一次，而且隔開一秒，符合 Nominatim 的使用規定）
    await new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS))
    return await queryNominatim(second, limit, ctrl.signal)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('搜尋逾時，請稍後再試')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
