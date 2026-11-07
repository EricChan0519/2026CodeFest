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

export async function searchPlaces(q: string, opts: { timeoutMs?: number; limit?: number } = {}): Promise<Place[]> {
  const query = q.trim()
  if (!query) return []
  const coords = parseCoordinates(query)
  if (coords) return [{ name: '輸入的座標', detail: `${coords[0]}, ${coords[1]}`, point: coords }]

  const { timeoutMs = 10000, limit = 5 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = new URL(NOMINATIM_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('countrycodes', 'tw')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('accept-language', 'zh-TW')
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`GEOCODE_HTTP_${res.status}`)
    return parseNominatim((await res.json()) as NominatimRow[])
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('搜尋逾時，請稍後再試')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
