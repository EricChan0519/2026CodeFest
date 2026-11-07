/**
 * 打自己的後端。正式環境走 Hosting rewrite（同網域 /api/**），本機走 Vite proxy。
 * 一律有 timeout，失敗丟 ApiError，畫面用 StateView 顯示錯誤。
 */
export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10000, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(path, {
      ...rest,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...rest.headers },
    })
    if (!res.ok) throw new ApiError(`伺服器回應錯誤（${res.status}）`, res.status)
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if ((e as Error).name === 'AbortError') throw new ApiError('連線逾時，請稍後再試')
    throw new ApiError('無法連線，請確認網路')
  } finally {
    clearTimeout(timer)
  }
}
