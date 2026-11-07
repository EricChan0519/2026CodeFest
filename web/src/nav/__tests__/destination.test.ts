import { describe, expect, it } from 'vitest'
import { arrivalFromStation, buildArrival, tripFromQuery } from '@/arrival/arrival'
import type { Station, StationRoute } from '@/lib/contract'
import { createAnnouncer } from '../announcer'
import {
  DEFAULT_DESTINATION,
  createDestinationLock,
  destinationFromBusOption,
  destinationFromStation,
  nearestPoint,
} from '../destination'
import type { Destination } from '../destination'
import { createNavMachine } from '../machine'
import { STRAIGHT, pt } from '../__fixtures__/routes'

// 馬路兩側各一個站位，相距 40 公尺
const STOP: Destination = { name: '測試站', points: [pt(0, 200), pt(40, 200)] }

describe('destination', () => {
  it('nearestPoint picks the closer stop position', () => {
    expect(nearestPoint(STOP, pt(-10, 0))).toEqual(STOP.points[0])
    expect(nearestPoint(STOP, pt(50, 0))).toEqual(STOP.points[1])
  })

  it('the lock picks the nearest stop once and keeps it for every reroute', () => {
    const lock = createDestinationLock(STOP)
    expect(lock.pick(pt(-10, 0))).toEqual(STOP.points[0])
    // 走偏到另一側：重算時目的地不可以跳到另一個站位
    expect(lock.pick(pt(60, 150))).toEqual(STOP.points[0])
    expect(lock.point).toEqual(STOP.points[0])
  })

  it('reset lets a new trip pick again', () => {
    const lock = createDestinationLock(STOP)
    lock.pick(pt(-10, 0))
    lock.reset()
    expect(lock.point).toBeNull()
    expect(lock.pick(pt(60, 150))).toEqual(STOP.points[1])
  })
})

const station: Station = {
  stationUid: 'TPE12345',
  name: { zh: '天母', en: 'Tianmu' },
  bearing: 'N',
  lat: 25.1169,
  lon: 121.5337,
  routes: [],
}
const stationRoute: StationRoute = {
  routeName: { zh: '307', en: '307' },
  direction: 0,
  headsign: { zh: '往板橋', en: 'To Banqiao' },
  stopUid: 'TPE99999',
}

describe('destination keeps the chosen bus', () => {
  it('destinationFromStation carries the Station and the chosen StationRoute', () => {
    const d = destinationFromStation(station, stationRoute)
    expect(d.station).toBe(station)
    expect(d.stationRoute).toBe(stationRoute)
    expect(d.name).toBe('天母')
    expect(d.points).toEqual([[25.1169, 121.5337]])
    expect(nearestPoint(d, [25.12, 121.53])).toEqual([25.1169, 121.5337])
  })

  it('the lab default destination has real station data so /arrived can be tested', () => {
    expect(DEFAULT_DESTINATION.station?.name.zh).toBeTruthy()
    expect(DEFAULT_DESTINATION.stationRoute?.routeName.zh).toBeTruthy()
    expect(DEFAULT_DESTINATION.points).toHaveLength(1)
  })
})

describe('arrival hand-off', () => {
  it('the /arrived URL has names only: no coordinates, no UIDs', () => {
    const d = destinationFromStation(station, stationRoute)
    const loc = arrivalFromStation(d.station!, d.stationRoute!, 'zh-TW', 'elder')
    expect(loc.path).toBe('/arrived')
    const text = JSON.stringify(loc)
    expect(text).not.toMatch(/25\.11|121\.53|TPE12345|TPE99999|LAB-DEMO/)
    expect(loc.query).toMatchObject({ stationZh: '天母', routeZh: '307', headsignZh: '往板橋', lang: 'zh-TW', audience: 'elder' })
  })

  it('the arrival screen speaks the sentence from the query, and navigation stays silent', () => {
    // 走到站：機器 -> 播報器，抵達那句不出聲
    let t = 1_000_000
    const m = createNavMachine({ route: STRAIGHT, now: () => t })
    const ann = createAnnouncer({ now: () => t })
    const cues: { key: string; speak: boolean; haptic: string | null }[] = []
    m.subscribe((v) => cues.push(...ann.update(v)))
    m.start()
    m.onPosition({ lat: pt(0, 190)[0], lon: pt(0, 190)[1], accuracyM: 8, ts: t })
    t += 1000
    m.onPosition({ lat: pt(0, 192)[0], lon: pt(0, 192)[1], accuracyM: 8, ts: t })
    expect(m.getView().state).toBe('arrived')
    const arrived = cues.filter((c) => c.key === 'arrived')
    expect(arrived).toHaveLength(1)
    expect(arrived[0]).toMatchObject({ speak: false, haptic: 'arrive' })

    // 到站畫面：從網址組出要念的那一句，只有這裡出聲
    const d = destinationFromStation(station, stationRoute)
    const loc = arrivalFromStation(d.station!, d.stationRoute!, 'zh-TW', 'visitor')
    const { trip, lang, audience } = tripFromQuery(loc.query)
    expect(buildArrival(trip, lang, audience).spoken).toBe('到了。等 307 號，往板橋方向')
  })
})

describe('destinationFromBusOption', () => {
  const board: Station = { stationUid: 'B', name: { zh: '上車站', en: 'Board' }, bearing: null, lat: 25.1, lon: 121.5, routes: [] }
  const alight: Station = { stationUid: 'A', name: { zh: '下車站', en: 'Alight' }, bearing: null, lat: 25.2, lon: 121.6, routes: [] }
  const route: StationRoute = {
    routeName: { zh: '203', en: '203' },
    direction: 0,
    headsign: { zh: '往天母', en: 'To Tianmu' },
    stopUid: 'S1',
  }

  it('navigates to the boarding stop and keeps the drop-off for arrival', () => {
    const d = destinationFromBusOption({ board, route, alight })
    expect(d.points).toEqual([[25.1, 121.5]])
    expect(d.station).toBe(board)
    expect(d.stationRoute).toBe(route)
    expect(d.alight).toBe(alight)
    const loc = arrivalFromStation(d.station!, d.stationRoute!, 'zh-TW', 'visitor', d.alight)
    expect(loc.query.alightZh).toBe('下車站')
  })
})
