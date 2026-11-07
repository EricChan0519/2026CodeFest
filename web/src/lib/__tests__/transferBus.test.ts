import { describe, expect, it } from 'vitest'
import type { LatLon, Station } from '@/lib/contract'
import type { RoutePattern } from '../directBus'
import { estimateBusMin, isWorthRiding, planBus, planTransferBus } from '../transferBus'

// 沿經線排的站位，緯度每 0.001 度約 111 公尺
const route = (name: string, stopUid: string) => ({
  routeName: { zh: name, en: name },
  direction: 0,
  headsign: { zh: `往${name}終點`, en: null },
  stopUid,
})
const station = (uid: string, lat: number, routes: string[], name = `站${uid}`, lon = 121.5): Station => ({
  stationUid: uid,
  name: { zh: name, en: null },
  bearing: null,
  lat,
  lon,
  routes: routes.map((r) => route(r, `${uid}-${r}`)),
})
const pattern = (name: string, stops: string[], extra: Partial<RoutePattern> = {}): RoutePattern => ({
  routeName: { zh: name, en: name },
  direction: 0,
  headsign: { zh: `往${name}終點`, en: null },
  stops,
  noBoard: [],
  noAlight: [],
  ...extra,
})

// 紅線 A → B → T；藍線 T2（和 T 同名、在對面約 44 公尺）→ D → E
const A = station('A', 25.0, ['紅'])
const B = station('B', 25.01, ['紅'])
const T = station('T', 25.02, ['紅'], '轉運站')
const T2 = station('T2', 25.02, ['藍'], '轉運站', 121.50044)
const D = station('D', 25.02, ['藍'], '站D', 121.51)
const E = station('E', 25.02, ['藍'], '站E', 121.52)
const stations = [A, B, T, T2, D, E]
const red = pattern('紅', ['A', 'B', 'T'])
const blue = pattern('藍', ['T2', 'D', 'E'])
const from: LatLon = [25.0003, 121.5] // A 旁邊約 33 公尺
const to: LatLon = [25.0202, 121.52] // E 旁邊約 22 公尺

describe('planTransferBus', () => {
  it('rides the first bus to a stop with the same name across the road and changes there', () => {
    const [o] = planTransferBus(stations, [red, blue], from, to)
    expect(o.rides.map((r) => r.route.routeName.zh)).toEqual(['紅', '藍'])
    expect(o.rides[0].board.stationUid).toBe('A')
    expect(o.rides[0].alight.stationUid).toBe('T')
    expect(o.rides[1].board.stationUid).toBe('T2')
    expect(o.rides[1].alight.stationUid).toBe('E')
    expect(o.rides[1].stops.map((s) => s.stationUid)).toEqual(['T2', 'D', 'E'])
    expect(o.transferWalkM).toBeGreaterThan(40)
    expect(o.transferWalkM).toBeLessThan(50)
    expect(o.stopCount).toBe(4)
  })

  it('does not change to a stop with a different name that is far away', () => {
    const far = station('T2', 25.02, ['藍'], '別的站', 121.502) // 約 200 公尺，名字不同
    expect(planTransferBus([A, B, T, far, D, E], [red, blue], from, to)).toEqual([])
  })

  it('respects stops where you cannot get off or cannot board', () => {
    expect(planTransferBus(stations, [pattern('紅', ['A', 'B', 'T'], { noAlight: [2] }), blue], from, to)).toEqual([])
    expect(planTransferBus(stations, [red, pattern('藍', ['T2', 'D', 'E'], { noBoard: [0] })], from, to)).toEqual([])
  })

  it('never pairs a route with itself', () => {
    const loop = pattern('紅', ['T2', 'D', 'E'])
    expect(planTransferBus(stations, [red, loop], from, to)).toEqual([])
  })

  it('returns nothing when no stop is within walking distance of the start', () => {
    expect(planTransferBus(stations, [red, blue], [24.9, 121.5], to)).toEqual([])
  })

  it('prefers far fewer stops over saving a few meters of walking', () => {
    // 綠線也從 A 附近到 T，但多繞 20 站；上車站只近 10 公尺
    const G = station('G', 25.0002, ['綠'])
    const detour = Array.from({ length: 20 }, (_, i) => station(`X${i}`, 24.9 - i * 0.01, ['綠']))
    const green = pattern('綠', ['G', ...detour.map((s) => s.stationUid), 'T'])
    const [o] = planTransferBus([...stations, G, ...detour], [green, red, blue], from, to)
    expect(o.rides[0].route.routeName.zh).toBe('紅')
  })
})

describe('planBus', () => {
  it('offers transfers only when there is no direct bus', () => {
    const plans = planBus(stations, [red, blue], from, to)
    expect(plans).toHaveLength(1)
    expect(plans[0].rides).toHaveLength(2)

    const direct = pattern('直', ['A', 'B', 'E'])
    const withDirect = planBus([A, B, T, T2, D, station('E', 25.02, ['藍', '直'], '站E', 121.52), station('A', 25.0, ['紅', '直'])].slice(0), [red, blue, direct], from, to)
    expect(withDirect.length).toBeGreaterThan(0)
    expect(withDirect.every((p) => p.rides.length === 1)).toBe(true)
    expect(withDirect[0].transferWalkM).toBe(0)
  })

  it('never suggests "ride 1 stop, transfer, ride 1 stop" for a 290 m trip (2026-11-07 回報)', () => {
    // 臺北車站實測：直接走 290 公尺；搭法要走 80 + 10 + 140 公尺、坐 1 站轉 1 站
    const S1 = station('S1', 25.0007, ['2'], '鄭州')
    const X = station('X', 25.004, ['2'], '行政院')
    const X2 = station('X2', 25.0041, ['5'], '行政院')
    const S3 = station('S3', 25.0013, ['5'], '公園')
    const from2: LatLon = [25.0, 121.5]
    const to2: LatLon = [25.0026, 121.5]
    const plans = planBus([S1, X, X2, S3], [pattern('2', ['S1', 'X']), pattern('5', ['X2', 'S3'])], from2, to2)
    expect(plans).toEqual([])
  })

  it('drops a direct bus that is slower than walking even if it saves some steps', () => {
    // 直接走約 670 公尺（10 分鐘）；繞路的車要走 2 × 110 公尺 + 等車 5 分 + 坐 3 站 ≈ 13 分 → 不比較快
    const P = station('P', 25.001, ['慢'])
    const M1 = station('M1', 25.002, ['慢'], '繞1', 121.51)
    const M2 = station('M2', 25.004, ['慢'], '繞2', 121.51)
    const Q = station('Q', 25.005, ['慢'])
    expect(planBus([P, M1, M2, Q], [pattern('慢', ['P', 'M1', 'M2', 'Q'])], [25.0, 121.5], [25.006, 121.5])).toEqual([])
  })

  it('keeps a bus that is clearly worth it', () => {
    const plans = planBus(stations, [red, blue], from, to)
    expect(plans).toHaveLength(1)
    const directM = 3000
    expect(isWorthRiding(plans[0]!, directM)).toBe(true)
    expect(estimateBusMin(plans[0]!)).toBeLessThan(directM / 67)
  })
})

