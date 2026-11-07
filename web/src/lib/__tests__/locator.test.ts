import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatLon } from '@/lib/contract'
import { createLocator } from '../locator'

/** 可以手動觸發的假 Geolocation */
function fakeGeo() {
  const pending: { ok: PositionCallback; fail?: PositionErrorCallback | null }[] = []
  const watchers = new Map<number, PositionCallback>()
  let nextId = 1
  const pos = ([lat, lon]: LatLon, accuracy = 10) =>
    ({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp: 0 }) as unknown as GeolocationPosition
  const geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      pending.push({ ok, fail })
    }),
    watchPosition: vi.fn((ok: PositionCallback) => {
      const id = nextId++
      watchers.set(id, ok)
      return id
    }),
    clearWatch: vi.fn((id: number) => watchers.delete(id)),
  }
  return {
    geo: geo as unknown as Geolocation,
    raw: geo,
    /** 回應最早一個 getCurrentPosition */
    answer(p: LatLon) {
      pending.shift()?.ok(pos(p))
    },
    deny() {
      pending.shift()?.fail?.({ code: 1 } as GeolocationPositionError)
    },
    /** watchPosition 送出一筆 */
    move(p: LatLon) {
      for (const cb of watchers.values()) cb(pos(p))
    },
    get watching() {
      return watchers.size
    },
  }
}

const A: LatLon = [25.1135, 121.5375]
const B: LatLon = [25.0478, 121.517]

describe('locator', () => {
  let t = 1_000_000
  beforeEach(() => {
    t = 1_000_000
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())
  const now = () => t

  it('asks for a position when it has none', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    const p = loc.current()
    g.answer(A)
    await expect(p).resolves.toEqual(A)
  })

  it('reuses a fresh position without asking again', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    const p = loc.current()
    g.answer(A)
    await p
    t += 5_000
    await expect(loc.current()).resolves.toEqual(A)
    expect(g.raw.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('asks again once the position is stale, so a new search uses where you are now', async () => {
    // 2026-11-07 回報：中斷導航、換個地方再搜尋，還在用第一次的位置
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    const first = loc.current()
    g.answer(A)
    await first
    t += 60_000
    const second = loc.current()
    expect(g.raw.getCurrentPosition).toHaveBeenCalledTimes(2)
    g.answer(B)
    await expect(second).resolves.toEqual(B)
  })

  it('follows watchPosition while the page is open', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    loc.start()
    loc.start() // 重複呼叫不會開第二個 watch
    expect(g.watching).toBe(1)
    g.move(A)
    t += 30_000
    g.move(B)
    await expect(loc.current()).resolves.toEqual(B)
    expect(g.raw.getCurrentPosition).not.toHaveBeenCalled()
    loc.stop()
    expect(g.watching).toBe(0)
  })

  it('takes positions fed from the navigation GPS', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    loc.feed(A, 5)
    t += 20_000
    loc.feed(B, 5)
    await expect(loc.current()).resolves.toEqual(B)
    expect(loc.lastFix).toMatchObject({ point: B, accuracyM: 5 })
  })

  it('falls back to a not-too-old position when asking fails', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    loc.feed(A)
    t += 30_000 // 不夠新，但還在 2 分鐘內
    const p = loc.current()
    g.deny()
    await expect(p).resolves.toEqual(A)
  })

  it('returns null instead of a very old position', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    loc.feed(A)
    t += 10 * 60_000
    const p = loc.current()
    g.deny()
    await expect(p).resolves.toBeNull()
  })

  it('gives up by itself when the WebView never answers', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now, timeoutMs: 3000 })
    const p = loc.current()
    vi.advanceTimersByTime(4001)
    await expect(p).resolves.toBeNull()
  })

  it('shares one request between concurrent callers', async () => {
    const g = fakeGeo()
    const loc = createLocator({ geo: g.geo, now })
    const p1 = loc.current()
    const p2 = loc.current()
    expect(g.raw.getCurrentPosition).toHaveBeenCalledTimes(1)
    g.answer(A)
    await expect(Promise.all([p1, p2])).resolves.toEqual([A, A])
  })

  it('works without geolocation', async () => {
    const loc = createLocator({ geo: null, now })
    loc.start()
    await expect(loc.current()).resolves.toBeNull()
  })
})
