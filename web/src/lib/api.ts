/**
 * 打自己的後端。正式環境走 Hosting rewrite（同網域 /api/**），本機走 Vite proxy。
 * 一律有 timeout，失敗丟 ApiError，畫面用 StateView 顯示錯誤。
 *
 * `VITE_API_MOCK=1` 時，api.nearby / api.search / api.routes 回傳 web/src/mocks 的假資料，
 * 不需要等後端。使用者座標只放 POST body，不放網址（ADR-0005）。
 */
import type {
  AroundRequest,
  AroundResponse,
  ForeignLang,
  NearbyRequest,
  PlaceSearchRequest,
  PlaceSearchResponse,
  RoutesRequest,
  RoutesResponse,
  StationsResponse,
  TranslateNamesResponse,
  TranslateQueryResponse,
} from './contract'

export class ApiError extends Error {
  status?: number
  /** 後端合約的錯誤碼，例如 ROUTE_NOT_FOUND */
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10000, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(path, {
      ...rest,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...rest.headers },
    })
    if (!res.ok) {
      let code: string | undefined
      try {
        code = ((await res.json()) as { error?: { code?: string } }).error?.code
      } catch {
        /* 回應不是 JSON，沿用 HTTP 狀態 */
      }
      throw new ApiError(`伺服器回應錯誤（${res.status}）`, res.status, code)
    }
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if ((e as Error).name === 'AbortError') throw new ApiError('連線逾時，請稍後再試')
    throw new ApiError('無法連線，請確認網路')
  } finally {
    clearTimeout(timer)
  }
}

export const isMockApi = (): boolean => import.meta.env.VITE_API_MOCK === '1'

const post = <T>(path: string, body: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs })

const endpoints = {
  nearby: async (lat: number, lon: number, radiusM = 500): Promise<StationsResponse> => {
    if (isMockApi()) return (await import('../mocks/stations-nearby.json')).default as unknown as StationsResponse
    const body: NearbyRequest = { lat, lon, radiusM }
    return post<StationsResponse>('/api/stations/nearby', body)
  },
  search: async (q: string): Promise<StationsResponse> => {
    if (isMockApi()) return (await import('../mocks/stations-search.json')).default as unknown as StationsResponse
    return request<StationsResponse>(`/api/stations/search?q=${encodeURIComponent(q)}`)
  },
  landmarks: async (req: PlaceSearchRequest): Promise<PlaceSearchResponse> => {
    if (isMockApi()) return { places: [], source: { name: 'Overture Maps Places', release: null, license: null, updatedAt: null } }
    return post<PlaceSearchResponse>('/api/landmarks/search', req, 8000)
  },
  translateQuery: async (q: string): Promise<TranslateQueryResponse> => {
    if (isMockApi()) return { lang: 'zh', queries: [], partial: false, segments: [] }
    // 搜尋前要等它。後端剛開機（Cloud Run 冷啟動、讀音表還在建）可能要好幾秒；
    // 3 秒太短會逾時改用原字串搜尋，「즈산역」就查不到（2026-11-08）。超過 8 秒才放棄
    return post<TranslateQueryResponse>('/api/translate/query', { q }, 8000)
  },
  translateNames: async (
    lang: ForeignLang,
    names: string[],
    addresses: string[] = [],
    categories: string[] = [],
  ): Promise<TranslateNamesResponse> => {
    if (isMockApi()) return { lang, names: names.map((zh) => ({ zh, text: null, exact: false })), addresses: [], categories: [] }
    return post<TranslateNamesResponse>('/api/translate/names', { lang, names, addresses, categories }, 8000)
  },
  around: async (req: AroundRequest): Promise<AroundResponse> => {
    if (isMockApi()) {
      return {
        radiusM: req.radiusM ?? 50,
        policeRadiusM: req.policeRadiusM ?? 150,
        lamps: { nearby: true, cells: 6 },
        cameras: 2,
        police: [{ name: '範例派出所', distanceM: 92 }],
        sources: [],
      }
    }
    return post<AroundResponse>('/api/around', req)
  },
  routes: async (req: RoutesRequest): Promise<RoutesResponse> => {
    if (isMockApi()) return (await import('../mocks/routes-one.json')).default as unknown as RoutesResponse
    return post<RoutesResponse>('/api/routes', req, 15000)
  },
}

/** `api<T>(path, init)` 保持原本用法；`api.nearby` 等是合約的型別化包裝。 */
export const api = Object.assign(request, endpoints)
