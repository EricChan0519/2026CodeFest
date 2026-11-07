import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/contract'
import { createNavMachine } from '@/nav/machine'
import { decodePolyline6, mapManeuverType, parseValhalla } from '../walkRoute'

// 2026-11-07 實際回應（天母東路口附近 → 忠誠路二段「啟智學校」站），只留 adapter 用到的欄位
const SHAPE =
  'cc|{n@u|pxfFmTfJ_d@tRcMhFyCyB}R{NuL_J_YeT}l@kc@sAeB|AsSfJqdA\\aFSad@B}K?mBu@gv@_CB{@maACoBrC@hAHtF^rIx@lJfBfGfBdF`B'
const RESPONSE = {
  trip: {
    summary: { length: 0.944, time: 881.645 },
    legs: [
      {
        shape: SHAPE,
        maneuvers: [
          { type: 2, length: 0.143, time: 143, begin_shape_index: 0 },
          { type: 10, length: 0.251, time: 246, begin_shape_index: 3 },
          { type: 10, length: 0.335, time: 314, begin_shape_index: 9 },
          { type: 15, length: 0.007, time: 6, begin_shape_index: 16, street_names: ['天母東路50巷'] },
          { type: 10, length: 0.113, time: 90, begin_shape_index: 17, street_names: ['天母東路'] },
          { type: 10, length: 0.095, time: 81, begin_shape_index: 19, street_names: ['忠誠路二段'] },
          { type: 5, length: 0, time: 0, begin_shape_index: 26 },
        ],
      },
    ],
  },
}

describe('walkRoute adapter', () => {
  it('decodes polyline6 into [lat, lon] near the origin and the school stop', () => {
    const g = decodePolyline6(SHAPE)
    expect(g).toHaveLength(27)
    // 起點會被 Valhalla 吸附到最近的步道，所以只檢查在要求的點附近
    expect(g[0]![0]).toBeCloseTo(25.1155, 2)
    expect(g[0]![1]).toBeCloseTo(121.53, 2)
    expect(g.at(-1)![0]).toBeCloseTo(25.11726, 3)
    expect(g.at(-1)![1]).toBeCloseTo(121.53427, 3)
  })

  it('maps valhalla maneuver types to contract kinds', () => {
    expect(mapManeuverType(2)).toBe('depart')
    expect(mapManeuverType(5)).toBe('arrive')
    expect(mapManeuverType(10)).toBe('right')
    expect(mapManeuverType(15)).toBe('left')
    expect(mapManeuverType(16)).toBe('slight_left')
    expect(mapManeuverType(40)).toBe('stairs')
    expect(mapManeuverType(8)).toBe('straight')
  })

  it('builds a route with arrive at the last point and no stairs', () => {
    const r = parseValhalla(RESPONSE, 'x')
    expect(r.distanceM).toBe(944)
    expect(r.durationS).toBe(882)
    expect(r.stairsCount).toBe(0)
    expect(r.maneuvers.at(-1)).toMatchObject({ kind: 'arrive', atIndex: r.geometry.length - 1 })
    expect(r.maneuvers[4]!.street).toBe('天母東路')
  })

  it('throws ROUTE_NOT_FOUND when there is no trip', () => {
    expect(() => parseValhalla({}, 'x')).toThrow('ROUTE_NOT_FOUND')
  })

  it('works as a nav route: starts at the origin, ends arrived at the stop', () => {
    const r = parseValhalla(RESPONSE, 'x')
    const m = createNavMachine({ route: r })
    m.start()
    m.onHeading(0)
    for (const p of r.geometry) m.onPosition({ lat: p[0], lon: p[1], accuracyM: 8, ts: Date.now() })
    expect(m.getView().state).toBe('arrived')
  })

  it('ends at the destination itself when Valhalla snapped the end onto a nearby road', () => {
    // 實測：全家板橋車站店，路線終點吸附到 13 公尺外的路上，站在店門口差一點就判斷不到抵達
    const end = decodePolyline6(SHAPE).at(-1)!
    const shop: LatLon = [end[0] + 0.00012, end[1]] // 北方約 13 公尺
    const r = parseValhalla(RESPONSE, 'walk', shop)
    expect(r.geometry.at(-1)).toEqual(shop)
    expect(r.maneuvers.at(-1)).toMatchObject({ kind: 'arrive', atIndex: r.geometry.length - 1 })
  })

  it('does not draw a straight line to a destination far from the road', () => {
    const end = decodePolyline6(SHAPE).at(-1)!
    const far: LatLon = [end[0] + 0.001, end[1]] // 約 110 公尺
    expect(parseValhalla(RESPONSE, 'walk', far).geometry.at(-1)).toEqual(end)
  })
})
