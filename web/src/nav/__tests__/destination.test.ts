import { describe, expect, it } from 'vitest'
import { arrivalFromStation, buildArrival, tripFromQuery } from '@/arrival/arrival'
import type { Station, StationRoute } from '@/lib/contract'
import { createAnnouncer } from '../announcer'
import { DEFAULT_DESTINATION, destinationFromStation, nearestPoint } from '../destination'
import { createNavMachine } from '../machine'
import { STRAIGHT, pt } from '../__fixtures__/routes'

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

  it('the lab default destination has demo station data so /arrived can be tested', () => {
    expect(DEFAULT_DESTINATION.station?.name.zh).toBeTruthy()
    expect(DEFAULT_DESTINATION.stationRoute?.routeName.zh).toBeTruthy()
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
