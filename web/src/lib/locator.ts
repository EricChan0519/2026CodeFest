/**
 * 使用者目前位置（搜尋排序、算公車用）。
 *
 * 2026-11-07 回報：第一次定位拿到的位置被一直沿用，中斷導航、走到別處再搜尋，距離和公車還是從舊位置算。
 * 改成：頁面開著就持續更新（watchPosition），導航中真實 GPS 的位置也會餵進來；
 * 每次要用位置時呼叫 current()，太舊就重新問一次，問不到才退回不太舊的上一筆。
 */
import type { LatLon } from '@/lib/contract'

export interface LocatorFix {
  point: LatLon
  accuracyM: number
  /** 取得的時間（ms） */
  at: number
}

export interface LocatorOptions {
  geo?: Geolocation | null
  now?: () => number
  /** 這麼新的位置直接用，不再問一次（毫秒） */
  freshMs?: number
  /** 問不到新位置時，上一筆最多可以多舊（毫秒）；再舊就當作不知道 */
  fallbackMs?: number
  /** 問一次位置最多等多久（毫秒） */
  timeoutMs?: number
}

export interface Locator {
  /** 開始持續更新位置（會觸發權限詢問）；重複呼叫沒關係 */
  start(): void
  stop(): void
  /** 別的來源（導航中的 GPS）拿到的位置 */
  feed(point: LatLon, accuracyM?: number): void
  /** 不超過 maxAgeMs 的最新位置，沒有就是 null */
  latest(maxAgeMs?: number): LatLon | null
  /** 目前位置：夠新就直接回傳，否則重新問；拒絕或逾時時回傳不太舊的上一筆，沒有就是 null */
  current(): Promise<LatLon | null>
  readonly lastFix: LocatorFix | null
}

export const LOCATOR_DEFAULTS = { freshMs: 10_000, fallbackMs: 120_000, timeoutMs: 8_000 } as const

function defaultGeo(): Geolocation | null {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null
}

export function createLocator(opts: LocatorOptions = {}): Locator {
  const geo = opts.geo === undefined ? defaultGeo() : opts.geo
  const now = opts.now ?? Date.now
  const freshMs = opts.freshMs ?? LOCATOR_DEFAULTS.freshMs
  const fallbackMs = opts.fallbackMs ?? LOCATOR_DEFAULTS.fallbackMs
  const timeoutMs = opts.timeoutMs ?? LOCATOR_DEFAULTS.timeoutMs

  let fix: LocatorFix | null = null
  let watchId: number | null = null
  let inflight: Promise<LatLon | null> | null = null

  function record(point: LatLon, accuracyM: number) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return
    fix = { point, accuracyM, at: now() }
  }

  function fromPosition(p: GeolocationPosition) {
    record([p.coords.latitude, p.coords.longitude], p.coords.accuracy ?? 0)
  }

  function latest(maxAgeMs = freshMs): LatLon | null {
    return fix && now() - fix.at <= maxAgeMs ? fix.point : null
  }

  return {
    start() {
      if (!geo || watchId !== null) return
      watchId = geo.watchPosition(fromPosition, () => {}, { enableHighAccuracy: true, maximumAge: 5000 })
    },
    stop() {
      if (geo && watchId !== null) geo.clearWatch(watchId)
      watchId = null
    },
    feed(point, accuracyM = 0) {
      record(point, accuracyM)
    },
    latest,
    current() {
      const fresh = latest(freshMs)
      if (fresh) return Promise.resolve(fresh)
      if (!geo) return Promise.resolve(latest(fallbackMs))
      inflight ??= new Promise<LatLon | null>((resolve) => {
        let done = false
        const finish = (v: LatLon | null) => {
          if (done) return
          done = true
          clearTimeout(timer)
          inflight = null
          resolve(v)
        }
        // 有些 WebView 權限視窗開著時不會觸發 timeout，自己再加一道保險
        const timer = setTimeout(() => finish(latest(fallbackMs)), timeoutMs + 1000)
        geo.getCurrentPosition(
          (p) => {
            fromPosition(p)
            finish(fix!.point)
          },
          () => finish(latest(fallbackMs)),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: freshMs },
        )
      })
      return inflight
    },
    get lastFix() {
      return fix
    },
  }
}
