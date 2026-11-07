import { describe, expect, it } from 'vitest'
import type { LatLon, Station } from '@/lib/contract'
import { planDirectBus, type RoutePattern } from '../directBus'

// 沿經線排的站位，緯度每 0.001 度約 111 公尺
const station = (uid: string, lat: number, routes: Station['routes'] = []): Station => ({
  stationUid: uid,
  name: { zh: `站${uid}`, en: `Stop ${uid}` },
  bearing: null,
  lat,
  lon: 121.5,
  routes,
})
const r307 = (direction: number, stopUid: string) => ({
  routeName: { zh: '307', en: '307' },
  direction,
  headsign: { zh: direction === 0 ? '往板橋' : '往撫遠街', en: null },
  stopUid,
})
const pattern = (direction: number, stops: string[], extra: Partial<RoutePattern> = {}): RoutePattern => ({
  routeName: { zh: '307', en: '307' },
  direction,
  headsign: { zh: direction === 0 ? '往板橋' : '往撫遠街', en: null },
  stops,
  noBoard: [],
  noAlight: [],
  ...extra,
})

const A = station('A', 25.0, [r307(0, 'a0'), r307(1, 'a1')])
const B = station('B', 25.01, [r307(0, 'b0'), r307(1, 'b1')])
const C = station('C', 25.02, [r307(0, 'c0'), r307(1, 'c1')])
const stations = [A, B, C]
const from: LatLon = [25.0003, 121.5] // A 旁邊約 33 公尺
const to: LatLon = [25.0202, 121.5] // C 旁邊約 22 公尺

describe('planDirectBus', () => {
  it('picks the direction that reaches the destination after the boarding stop', () => {
    const options = planDirectBus(stations, [pattern(0, ['A', 'B', 'C']), pattern(1, ['C', 'B', 'A'])], from, to)
    expect(options).toHaveLength(1)
    const [o] = options
    expect(o.board.stationUid).toBe('A')
    expect(o.alight.stationUid).toBe('C')
    expect(o.route).toEqual(r307(0, 'a0'))
    expect(o.stopCount).toBe(2)
    expect(Math.round(o.walkToBoardM)).toBe(33)
    expect(Math.round(o.walkFromAlightM)).toBe(22)
  })

  it('skips stops where you cannot board or cannot get off', () => {
    expect(planDirectBus(stations, [pattern(0, ['A', 'B', 'C'], { noBoard: [0] })], from, to)).toEqual([])
    expect(planDirectBus(stations, [pattern(0, ['A', 'B', 'C'], { noAlight: [2] })], from, to)).toEqual([])
  })

  it('returns nothing when no stop is within walking distance', () => {
    expect(planDirectBus(stations, [pattern(0, ['A', 'B', 'C'])], [25.1, 121.5], to)).toEqual([])
  })

  it('does not suggest a bus when start and destination share the same stop', () => {
    expect(planDirectBus(stations, [pattern(0, ['A', 'B', 'C'])], from, [25.0004, 121.5])).toEqual([])
  })

  it('ranks the option with less walking first', () => {
    const far = station('F', 25.0035, [{ ...r307(0, 'f0'), routeName: { zh: '紅3', en: 'R3' } }])
    const red: RoutePattern = { ...pattern(0, ['F', 'C']), routeName: { zh: '紅3', en: 'R3' } }
    const options = planDirectBus([...stations, far], [red, pattern(0, ['A', 'B', 'C'])], from, to)
    expect(options.map((o) => o.route.routeName.zh)).toEqual(['307', '紅3'])
  })

  it('uses the closest boarding stop on a pattern, not the first one in range', () => {
    const A2 = station('A2', 24.9985, [r307(0, 'x0')]) // 約 200 公尺，比 A 遠
    const options = planDirectBus([A2, ...stations], [pattern(0, ['A2', 'A', 'B', 'C'])], from, to)
    expect(options[0].board.stationUid).toBe('A')
  })

  it('skips a pattern whose boarding station does not list that route', () => {
    const bare = station('A', 25.0)
    expect(planDirectBus([bare, B, C], [pattern(0, ['A', 'B', 'C'])], from, to)).toEqual([])
  })

  it('drops a bus that does not save walking compared with walking straight there', () => {
    const near = station('N', 25.001, [r307(0, 'n0')])
    // 起點在 A 東邊約 300 公尺，終點在 N 東邊約 300 公尺；兩點直線只有約 111 公尺
    const options = planDirectBus([A, near], [pattern(0, ['A', 'N'])], [25.0, 121.503], [25.001, 121.503])
    expect(options).toEqual([])
  })

  it('lists every stop from boarding to alighting for the ride screen', () => {
    const [o] = planDirectBus(stations, [pattern(0, ['A', 'B', 'C'])], from, to)
    expect(o.stops.map((s) => s.stationUid)).toEqual(['A', 'B', 'C'])
  })
})
