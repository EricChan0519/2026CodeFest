import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/contract'
import { createNavMachine } from '@/nav/machine'
import { SHIDONG_EDGES, SHIDONG_ROUTE } from '../__fixtures__/shidongCrossing'
import { applyCrossings, decodePolyline6, findCrossings, mapManeuverType, parseValhalla } from '../walkRoute'
import type { TraceEdge } from '../walkRoute'

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

describe('crossings (先過馬路再轉彎)', () => {
  const raw = () => parseValhalla(SHIDONG_ROUTE, 'x')

  it('before the fix: Valhalla says "right" at the south curb, before crossing 士東路', () => {
    expect(raw().maneuvers.map((m) => `${m.kind}@${m.atIndex}`)).toEqual([
      'depart@0',
      'right@2',
      'right@6',
      'left@8',
      'arrive@9',
    ])
  })

  it('finds the 士東路 crosswalk and ignores the short one across the lane mouth', () => {
    const c = findCrossings(SHIDONG_EDGES, raw().geometry)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ from: 2, to: 6 })
    expect(c[0]!.lengthM).toBeGreaterThan(30)
  })

  it('cross 士東路 first, then turn right; the turn onto the crosswalk is gone', () => {
    const r = raw()
    const ms = applyCrossings(r.maneuvers, r.geometry, SHIDONG_EDGES)
    expect(ms.map((m) => `${m.kind}@${m.atIndex}`)).toEqual(['depart@0', 'cross@6', 'left@8', 'arrive@9'])
    expect(ms[1]).toMatchObject({ kind: 'cross', fromIndex: 2, atIndex: 6, then: 'right' })
    // 沒有任何「右轉」在過馬路之前
    expect(ms.some((m) => m.kind === 'right')).toBe(false)
    expect(ms[1]!.distanceToNextM).toBeGreaterThan(15)
  })

  it('a straight crossing with no turn after it is just "cross"', () => {
    const r = raw()
    const edges: TraceEdge[] = SHIDONG_EDGES.map((e) => (e.begin_shape_index >= 6 ? { ...e, use: 'footway' } : e))
    const maneuvers = r.maneuvers.filter((m) => m.atIndex !== 6 && m.atIndex !== 8)
    const ms = applyCrossings(maneuvers, r.geometry, edges)
    expect(ms.find((m) => m.kind === 'cross')).toMatchObject({ then: null })
  })

  it('without crossing info the route is unchanged', () => {
    const r = raw()
    expect(applyCrossings(r.maneuvers, r.geometry, [])).toEqual(r.maneuvers)
  })

  it('jog onto a main road with no crosswalk: cross at the first corner, then turn', () => {
    // 北走 100 m 到大馬路（tertiary）中線，右轉走 30 m，再左轉往北。人在馬路南側，要先過馬路再右轉
    const g: LatLon[] = [
      [25.1, 121.5],
      [25.1009, 121.5],
      [25.1009, 121.5003],
      [25.1018, 121.5003],
    ]
    const ms = applyCrossings(
      [
        { kind: 'depart', atIndex: 0, distanceToNextM: 100, street: null },
        { kind: 'right', atIndex: 1, distanceToNextM: 30, street: '士東路' },
        { kind: 'left', atIndex: 2, distanceToNextM: 100, street: '士東路299巷' },
        { kind: 'arrive', atIndex: 3, distanceToNextM: 0, street: null },
      ],
      g,
      [
        { use: 'road', road_class: 'residential', begin_shape_index: 0, end_shape_index: 1 },
        { use: 'road', road_class: 'tertiary', begin_shape_index: 1, end_shape_index: 2 },
        { use: 'road', road_class: 'residential', begin_shape_index: 2, end_shape_index: 3 },
      ],
    )
    expect(ms[1]).toMatchObject({ kind: 'cross', atIndex: 1, fromIndex: 1, then: 'right', street: '士東路' })
    expect(ms[2]).toMatchObject({ kind: 'left', atIndex: 2 })
  })

  it('jog inside small lanes is left alone (no need to cross a lane)', () => {
    const g: LatLon[] = [
      [25.1, 121.5],
      [25.1009, 121.5],
      [25.1009, 121.5003],
      [25.1018, 121.5003],
    ]
    const input = [
      { kind: 'depart' as const, atIndex: 0, distanceToNextM: 100, street: null },
      { kind: 'right' as const, atIndex: 1, distanceToNextM: 30, street: '士東路286巷5弄' },
      { kind: 'left' as const, atIndex: 2, distanceToNextM: 100, street: null },
      { kind: 'arrive' as const, atIndex: 3, distanceToNextM: 0, street: null },
    ]
    const ms = applyCrossings(input, g, [
      { use: 'road', road_class: 'residential', begin_shape_index: 0, end_shape_index: 3 },
      { use: 'road', road_class: 'residential', begin_shape_index: 1, end_shape_index: 2 },
    ])
    expect(ms.map((m) => m.kind)).toEqual(['depart', 'right', 'left', 'arrive'])
  })
})
