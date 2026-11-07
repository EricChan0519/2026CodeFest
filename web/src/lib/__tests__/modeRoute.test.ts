import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteOption } from '@/lib/contract'
import { fetchRoutePlan, toModeRoute } from '@/lib/modeRoute'
import { ROUTE_MODE_STRINGS } from '@/i18n/routeMode'
import { factTexts, reasonTexts, routeDetail } from '@/trip/routeText'

const zh = ROUTE_MODE_STRINGS['zh-TW']

function option(over: Partial<RouteOption> = {}): RouteOption {
  return {
    id: 'safe',
    recommended: true,
    reasons: ['more_cameras', 'more_stores', 'extra_time'],
    distanceM: 300,
    durationS: 240,
    // 往北約 22 公尺一點
    geometry: [
      [25.1, 121.5],
      [25.1002, 121.5],
      [25.1004, 121.5],
      [25.1006, 121.5],
    ],
    maneuvers: [
      { kind: 'depart', atIndex: 0, distanceToNextM: 66, street: null },
      { kind: 'arrive', atIndex: 3, distanceToNextM: 0, street: null },
    ],
    metrics: {
      steps: 0, climbM: 1, litRatio: 1, unsignalizedCrossings: 0, signalCrossings: 0, unknownCrossings: 0,
      cameras: 9, policeNearby: 1, stores: 3,
    },
    diff: { distanceM: 60, durationS: 130, steps: 0, climbM: 0, unsignalizedCrossings: 0, cameras: 5, stores: 2 },
    edges: null,
    ...over,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('toModeRoute', () => {
  it('links the last metres to the destination and keeps arrive last', () => {
    const r = toModeRoute(option(), [25.1008, 121.5])
    expect(r.geometry).toHaveLength(5)
    expect(r.maneuvers.at(-1)).toMatchObject({ kind: 'arrive', atIndex: 4 })
    expect(r.crossCount).toBeNull()
  })

  it('uses backend edges to find a road crossing', () => {
    const r = toModeRoute(
      option({
        edges: [
          [0, 1, 'sidewalk', 'secondary'],
          [1, 2, 'pedestrian_crossing', 'secondary'],
          [2, 3, 'sidewalk', 'secondary'],
        ],
      }),
    )
    expect(r.crossCount).toBe(1)
    expect(r.maneuvers.some((m) => m.kind === 'cross')).toBe(true)
  })
})

describe('route text', () => {
  it('says why the recommended route is better, extra time last', () => {
    const r = toModeRoute(option())
    expect(reasonTexts(r, zh)).toEqual(['監視器多 5 支', '便利商店多 2 家', '多走約 2 分鐘'])
    expect(routeDetail(r, 'safe', zh)).toBe('監視器多 5 支 · 便利商店多 2 家 · 多走約 2 分鐘')
  })

  it('describes the fastest route by what is along it', () => {
    const fastest = toModeRoute(option({ id: 'fastest', reasons: ['fastest'], diff: null }))
    expect(routeDetail(fastest, 'safe', zh)).toBe('沿路 9 支監視器 · 3 家便利商店 · 經過派出所附近')
    expect(factTexts(fastest, 'gentle', zh)).toEqual(['沒有階梯', '坡度平緩'])
    expect(factTexts(fastest, 'fast', zh)).toEqual([])
  })

  it('a gentle route that still has stairs says so', () => {
    const r = toModeRoute(
      option({
        id: 'gentle',
        reasons: ['fewer_steps', 'extra_time'],
        metrics: { steps: 1, climbM: 0, litRatio: 1, unsignalizedCrossings: 0, signalCrossings: 0, unknownCrossings: 0 },
        diff: { distanceM: 60, durationS: 70, steps: 1, climbM: 0, unsignalizedCrossings: 0 },
      }),
    )
    expect(routeDetail(r, 'gentle', zh)).toBe('少走 1 段階梯 · 還有 1 段階梯 · 多走約 1 分鐘')
  })

  it('says nothing when the data is missing', () => {
    const r = toModeRoute(option({ id: 'fastest', reasons: ['fastest'], diff: null, metrics: null }))
    expect(routeDetail(r, 'safe', zh)).toBe('')
  })
})

describe('fetchRoutePlan', () => {
  it('sends the mode and returns recommended first', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.mode).toBe('gentle')
      expect(body.audience).toBe('elder')
      return new Response(
        JSON.stringify({
          context: { audience: 'elder', period: 'day', simulated: false, mode: 'gentle', maxTimeRatio: 1.2 },
          routes: [option({ id: 'gentle' }), option({ id: 'fastest', recommended: false, reasons: ['fastest'], diff: null })],
          notes: [],
          sources: [],
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const plan = await fetchRoutePlan([25.1, 121.5], [25.1006, 121.5], 'gentle', 'elder')
    expect(plan.routes.map((r) => r.id)).toEqual(['gentle', 'fastest'])
    expect(plan.fallback).toBe(false)
  })

  it('does not fall back when the backend says there is no path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ROUTE_NOT_FOUND' } }), { status: 404 })))
    await expect(fetchRoutePlan([25.1, 121.5], [25.1006, 121.5], 'safe', 'child')).rejects.toMatchObject({ code: 'ROUTE_NOT_FOUND' })
  })
})
