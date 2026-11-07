import { describe, expect, it } from 'vitest'
import type { LatLon, Station } from '@/lib/contract'
import type { RoutePattern } from '@/lib/directBus'
import type { MetroIndex } from '@/lib/metroIndex'
import { planTransit, metroUid, MAX_WALK_M, WALK_ONLY_M } from '@/lib/transitPlan'
import mini from '../__fixtures__/metro_index.mini.json'

const metro = mini as MetroIndex

// 小快照的車站座標（見 metro_index.mini.json）
const XIMEN: LatLon = [25.0421, 121.5081]
const ZHONGSHAN: LatLon = [25.0527, 121.5203]
const SHUANGLIAN: LatLon = [25.0577, 121.5205]

function stop(uid: string, zh: string, lat: number, lon: number, route: string, direction = 0): Station {
  return {
    stationUid: uid,
    name: { zh, en: null },
    bearing: null,
    lat,
    lon,
    routes: [{ routeName: { zh: route, en: route }, direction, headsign: { zh: '往終點', en: null }, stopUid: uid + '-s' }],
  }
}

/** 公車 9 從西門附近往北開到雙連附近，沿途 8 站 */
function busLine(): { stations: Station[]; patterns: RoutePattern[] } {
  const stations: Station[] = []
  for (let i = 0; i <= 8; i++) {
    const lat = 25.0421 + (25.0577 - 25.0421) * (i / 8)
    const lon = 121.5085 + (121.5209 - 121.5085) * (i / 8)
    stations.push(stop(`TPE${i}`, `公車站${i}`, lat, lon, '9'))
  }
  return {
    stations,
    patterns: [
      {
        routeName: { zh: '9', en: '9' },
        direction: 0,
        headsign: { zh: '往終點', en: null },
        stops: stations.map((s) => s.stationUid),
        noBoard: [],
        noAlight: [],
      },
    ],
  }
}

const NO_BUS = { stations: [], patterns: [] }

describe('planTransit metro', () => {
  it('rides Bannan then changes to Tamsui-Xinyi at Taipei Main Station', () => {
    const plans = planTransit(NO_BUS, metro, XIMEN, ZHONGSHAN, { audience: 'visitor' })
    const best = plans.metro[0]
    expect(best.rides.map((r) => [r.mode, r.board.stationUid, r.alight.stationUid])).toEqual([
      ['metro', metroUid('BL11'), metroUid('BL12')],
      ['metro', metroUid('R10'), metroUid('R11')],
    ])
    expect(best.rides[0].route.headsign.zh).toBe('往南港展覽館')
    expect(best.rides[1].route.headsign.zh).toBe('往淡水')
    expect(best.rides[1].route.routeName.zh).toBe('淡水信義線')
    expect(best.rides[0].lineColor).toBe('#0070BD')
  })

  it('gives cumulative stop times and exits for metro rides', () => {
    const best = planTransit(NO_BUS, metro, XIMEN, SHUANGLIAN, { audience: 'visitor' }).metro[0]
    const r = best.rides[1]
    expect(r.stops.map((s) => s.stationUid)).toEqual([metroUid('R10'), metroUid('R11'), metroUid('R12')])
    expect(r.stopTimesS).toEqual([0, 110, 200])
    expect(best.rides[0].boardExit).toBe('6')
    expect(best.rides[0].boardPoint).toEqual([25.0424, 121.507])
  })

  it('adds the wait, ride and in-station transfer into durationS', () => {
    const best = planTransit(NO_BUS, metro, XIMEN, ZHONGSHAN, { audience: 'visitor' }).metro[0]
    // 兩次候車各 150 秒、行車 120 + 110 秒；站內換線 240 秒算在步行
    expect(best.waitS).toBe(300)
    expect(best.rideS).toBe(230)
    expect(best.walkS).toBeGreaterThanOrEqual(240)
    expect(best.durationS).toBe(best.walkS + best.waitS + best.rideS)
  })

  it('walks further to a station when none is within 800 m', () => {
    // 小快照最西邊的 BL10 再往西約 1.3 公里，800 公尺內沒有任何車站
    const west: LatLon = [25.0353, 121.487]
    const best = planTransit(NO_BUS, metro, west, ZHONGSHAN, { audience: 'visitor' }).metro[0]
    expect(best).toBeDefined()
    expect(best.rides[0].board.stationUid).toBe(metroUid('BL10'))
    expect(best.walkM).toBeGreaterThan(MAX_WALK_M)
  })

  it('walks to the metro even when the nearest station is 3 km away and there is no bus', () => {
    const farWest: LatLon = [25.0353, 121.468] // BL10 往西約 3.2 公里
    const plans = planTransit(NO_BUS, metro, farWest, ZHONGSHAN, { audience: 'visitor' })
    expect(plans.metro.length).toBeGreaterThan(0)
    expect(plans.metro[0].rides[0].board.stationUid).toBe(metroUid('BL10'))
    expect(plans.mixed.some((p) => p.rides.length > 0)).toBe(true)
  })

  it('has no metro plans when the metro snapshot is missing', () => {
    const plans = planTransit(busLine(), null, XIMEN, SHUANGLIAN, { audience: 'visitor' })
    expect(plans.metro).toEqual([])
    expect(plans.mixed.every((p) => p.rides.every((r) => r.mode === 'bus'))).toBe(true)
  })
})

describe('planTransit bus and mixed', () => {
  it('finds the direct bus in the bus tab', () => {
    const plans = planTransit(busLine(), metro, XIMEN, SHUANGLIAN, { audience: 'visitor' })
    const best = plans.bus[0]
    expect(best.rides).toHaveLength(1)
    expect(best.rides[0].mode).toBe('bus')
    expect(best.rides[0].route.routeName.zh).toBe('9')
    expect(best.rides[0].board.stationUid).toBe('TPE0')
    expect(best.rides[0].alight.stationUid).toBe('TPE8')
  })

  it('mixed lists the fastest of every mode, sorted by duration', () => {
    const plans = planTransit(busLine(), metro, XIMEN, SHUANGLIAN, { audience: 'visitor' })
    const all = [...plans.bus, ...plans.metro].map((p) => p.durationS)
    expect(plans.mixed[0].durationS).toBe(Math.min(...all))
    const d = plans.mixed.map((p) => p.durationS)
    expect(d).toEqual([...d].sort((a, b) => a - b))
    expect(plans.mixed.length).toBeLessThanOrEqual(3)
  })

  it('does not list a bus route that is not allowed to board there', () => {
    const net = busLine()
    net.patterns[0].noBoard = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    expect(planTransit(net, null, XIMEN, SHUANGLIAN, { audience: 'visitor' }).bus).toEqual([])
  })

  it('suggests walking when the destination is close', () => {
    const near: LatLon = [XIMEN[0] + 0.002, XIMEN[1]]
    const plans = planTransit(busLine(), metro, XIMEN, near, { audience: 'visitor' })
    expect(plans.mixed[0].rides).toEqual([])
    expect(plans.mixed[0].walkM).toBeLessThan(WALK_ONLY_M)
  })

  it('keeps plans slower than walking as choices, after the faster ones', () => {
    // 西門和台北車站中間：走過去比進站等車快，但捷運仍列出來讓使用者選
    const between: LatLon = [25.0447, 121.5135]
    const plans = planTransit(NO_BUS, metro, XIMEN, between, { audience: 'visitor' })
    const walk = plans.mixed.find((p) => p.rides.length === 0)!
    expect(walk).toBeDefined()
    expect(plans.metro.length).toBeGreaterThan(0)
    expect(plans.metro[0].durationS).toBeGreaterThan(walk.durationS)
    expect(plans.mixed[0]).toBe(walk)
    expect(plans.mixed.some((p) => p.rides.length > 0)).toBe(true)
  })

  it('estimates longer trips for elders, who walk slower', () => {
    const visitor = planTransit(NO_BUS, metro, XIMEN, ZHONGSHAN, { audience: 'visitor' }).metro[0]
    const elder = planTransit(NO_BUS, metro, XIMEN, ZHONGSHAN, { audience: 'elder' }).metro[0]
    expect(elder.walkS).toBeGreaterThan(visitor.walkS)
  })

  it('never uses more than three rides', () => {
    const plans = planTransit(busLine(), metro, XIMEN, SHUANGLIAN, { audience: 'visitor' })
    for (const tab of [plans.mixed, plans.bus, plans.metro]) for (const p of tab) expect(p.rides.length).toBeLessThanOrEqual(3)
  })
})

describe('planTransit service hours', () => {
  /** 小快照加上首末班：每站首班 06:00、末班 23:30 */
  function withHours(): MetroIndex {
    const m = structuredClone(metro)
    for (const p of m.patterns) {
      p.firstS = p.stops.map((_, i) => (i === p.stops.length - 1 ? null : 6 * 3600))
      p.lastS = p.stops.map((_, i) => (i === p.stops.length - 1 ? null : 23 * 3600 + 30 * 60))
    }
    return m
  }
  const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m) // 2026-11-09 星期一

  it('marks plans whose last train has left', () => {
    const plans = planTransit(NO_BUS, withHours(), XIMEN, ZHONGSHAN, { audience: 'visitor', now: at(23, 55) })
    expect(plans.metro[0].service).toBe('ended')
  })

  it('marks plans before the first train', () => {
    const plans = planTransit(NO_BUS, withHours(), XIMEN, ZHONGSHAN, { audience: 'visitor', now: at(5, 0) })
    expect(plans.metro[0].service).toBe('not_started')
  })

  it('treats 00:30 as the same service night, after the last train', () => {
    const plans = planTransit(NO_BUS, withHours(), XIMEN, ZHONGSHAN, { audience: 'visitor', now: new Date(2026, 10, 10, 0, 30) })
    expect(plans.metro[0].service).toBe('ended')
  })

  it('is ok during service hours and when there are no service times', () => {
    expect(planTransit(NO_BUS, withHours(), XIMEN, ZHONGSHAN, { audience: 'visitor', now: at(12) }).metro[0].service).toBe('ok')
    expect(planTransit(NO_BUS, metro, XIMEN, ZHONGSHAN, { audience: 'visitor', now: at(23, 59) }).metro[0].service).toBe('ok')
  })

  it('uses the weekday or weekend bus window and lists runnable plans first', () => {
    const net = busLine()
    net.patterns[0].service = { weekday: [6 * 3600, 22 * 3600], weekend: [7 * 3600, 23 * 3600] }
    const monday = planTransit(net, withHours(), XIMEN, SHUANGLIAN, { audience: 'visitor', now: at(22, 30) })
    expect(monday.bus[0].service).toBe('ended')
    expect(monday.mixed[0].service).toBe('ok')
    const saturday = planTransit(net, null, XIMEN, SHUANGLIAN, { audience: 'visitor', now: new Date(2026, 10, 7, 22, 30) })
    expect(saturday.bus[0].service).toBe('ok')
  })
})
