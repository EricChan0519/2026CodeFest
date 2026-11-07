import { describe, expect, it } from 'vitest'
import { arrivalFromStation, arrivalLocation, askCard, buildArrival, tripFromQuery, type ArrivalTrip } from '../arrival'
import type { Station } from '@/lib/contract'

const trip: ArrivalTrip = {
  station: { zh: '臺北車站(鄭州)', en: 'Taipei Main Sta. (Zhengzhou)' },
  route: { zh: '307', en: '307' },
  headsign: { zh: '板橋', en: 'Banqiao' },
}
const noHeadsign: ArrivalTrip = { ...trip, headsign: { zh: null, en: null } }
const red: ArrivalTrip = { ...trip, route: { zh: '紅3', en: 'R3' } }

describe('buildArrival', () => {
  it('says the bus and direction in Chinese', () => {
    const a = buildArrival(trip, 'zh-TW', 'visitor')
    expect(a.routeBig).toBe('307')
    expect(a.direction).toBe('往板橋')
    expect(a.spoken).toBe('到了。等 307 號，往板橋方向')
    expect(a.speechLang).toBe('zh-TW')
    expect(a.rate).toBe('normal')
  })

  it('does not add 號 to route names that are not plain numbers', () => {
    expect(buildArrival(red, 'zh-TW', 'visitor').spoken).toBe('到了。等 紅3，往板橋方向')
  })

  it('leaves out the direction when headsign is missing, and never says null', () => {
    const a = buildArrival(noHeadsign, 'zh-TW', 'visitor')
    expect(a.direction).toBeNull()
    expect(a.spoken).toBe('到了。等 307 號')
    expect(JSON.stringify(a)).not.toMatch(/null"|undefined/)
  })

  it('strips a leading 往 from the headsign instead of doubling it', () => {
    const t = { ...trip, headsign: { zh: '往板橋', en: null } }
    expect(buildArrival(t, 'zh-TW', 'visitor').direction).toBe('往板橋')
    expect(buildArrival(t, 'zh-TW', 'visitor').spoken).toContain('往板橋方向')
  })

  it('handles the real headsign format, including English To and loop notes', () => {
    const t: ArrivalTrip = { ...trip, headsign: { zh: '往天母（迴圈）', en: 'To Tianmu (Loop)' } }
    expect(buildArrival(t, 'zh-TW', 'visitor').direction).toBe('往天母（迴圈）')
    expect(buildArrival(t, 'en', 'visitor').direction).toBe('To Tianmu (Loop)')
    expect(buildArrival(t, 'en', 'visitor').spoken).toBe("You're here. Wait for bus 307, to Tianmu (Loop)")
    expect(askCard(t, 'en')!.zh).toBe('我要搭 307 號公車，往天母（迴圈）。請問是這班車嗎？')
  })

  it('encourages children', () => {
    expect(buildArrival(trip, 'zh-TW', 'child').spoken).toBe('你做到了！等 307 號，往板橋方向')
  })

  it('slows speech for elders', () => {
    expect(buildArrival(trip, 'zh-TW', 'elder').rate).toBe('slow')
  })

  it('follows the name rules for English and other languages', () => {
    const en = buildArrival(trip, 'en', 'visitor')
    expect(en.direction).toBe('To Banqiao')
    expect(en.spoken).toBe("You're here. Wait for bus 307, to Banqiao")
    expect(en.speechLang).toBe('en-US')
    expect(en.station).toBe('Taipei Main Sta. (Zhengzhou)')
    const th = buildArrival(trip, 'th', 'visitor')
    expect(th.station).toBe('Taipei Main Sta. (Zhengzhou) 臺北車站(鄭州)')
    expect(th.speechLang).toBe('th-TH')
    expect(th.spoken).toContain('Banqiao')
  })

  it('falls back to Chinese when English names are missing', () => {
    const t: ArrivalTrip = { station: { zh: '站', en: null }, route: { zh: '紅3', en: null }, headsign: { zh: '板橋', en: null } }
    const en = buildArrival(t, 'en', 'visitor')
    expect(en.routeBig).toBe('紅3')
    expect(en.station).toBe('站')
    expect(en.direction).toBe('To 板橋')
    expect(buildArrival(t, 'ko', 'visitor').station).toBe('站')
  })

  it('shows the Chinese route under a different English name, to match the bus sign', () => {
    const a = buildArrival(red, 'en', 'visitor')
    expect(a.routeBig).toBe('R3')
    expect(a.routeSub).toBe('紅3')
    expect(buildArrival(trip, 'en', 'visitor').routeSub).toBeNull()
    expect(buildArrival(red, 'zh-TW', 'visitor').routeSub).toBeNull()
  })

  it('still works with no route at all', () => {
    const a = buildArrival({ ...trip, route: { zh: '', en: null } }, 'zh-TW', 'visitor')
    expect(a.routeBig).toBeNull()
    expect(a.spoken).toBe('到了')
  })

  it.each(['zh-TW', 'en', 'th', 'vi', 'id', 'km', 'ja', 'ko'] as const)('has every string for %s', (lang) => {
    const a = buildArrival(trip, lang, 'child')
    for (const text of [a.headline, a.spoken, a.labels.showOthers, a.labels.done, a.labels.hearAgain, a.labels.askHint, a.labels.back, a.labels.readAloud]) {
      expect(text).toBeTruthy()
      expect(text).not.toMatch(/\{|\}|undefined/)
    }
    expect(a.spoken).toContain('307')
  })
})

describe('askCard', () => {
  it('is always in Chinese with the route and direction', () => {
    const c = askCard(trip, 'th')!
    expect(c.zh).toBe('我要搭 307 號公車，往板橋。請問是這班車嗎？')
    expect(c.lang).toBe('zh-TW')
    expect(c.station).toBe('我在：臺北車站(鄭州)')
  })

  it('translates the question for the owner of the phone, except in Chinese', () => {
    expect(askCard(trip, 'en')!.own).toBe('I want bus 307, to Banqiao. Is this the right bus?')
    expect(askCard(trip, 'zh-TW')!.own).toBeNull()
  })

  it('works without a headsign and uses the Chinese route name', () => {
    expect(askCard(noHeadsign, 'en')!.zh).toBe('我要搭 307 號公車。請問是這班車嗎？')
    expect(askCard(red, 'en')!.zh).toBe('我要搭 紅3 公車，往板橋。請問是這班車嗎？')
  })

  it('is unavailable with no route', () => {
    expect(askCard({ ...trip, route: { zh: '', en: null } }, 'en')).toBeNull()
  })
})

describe('query round trip', () => {
  it('restores the trip, language and audience', () => {
    const loc = arrivalLocation(trip, 'en', 'elder')
    expect(loc.path).toBe('/arrived')
    expect(tripFromQuery(loc.query)).toEqual({ trip, lang: 'en', audience: 'elder' })
  })

  it('keeps missing names as null', () => {
    const { trip: t } = tripFromQuery(arrivalLocation(noHeadsign, 'en', 'elder').query)
    expect(t.headsign).toEqual({ zh: null, en: null })
  })

  it('falls back on bad or missing values', () => {
    const r = tripFromQuery({ lang: 'xx', audience: 'cat', route: ['a', 'b'] })
    expect(r.lang).toBe('zh-TW')
    expect(r.audience).toBe('visitor')
    expect(r.trip.route.zh).toBe('')
  })

  it('carries no coordinates', () => {
    expect(Object.keys(arrivalLocation(trip, 'en', 'elder').query).join()).not.toMatch(/lat|lon/)
  })
})

describe('arrivalFromStation', () => {
  const station: Station = {
    stationUid: 'TPE123',
    name: { zh: '臺北車站(鄭州)', en: 'Taipei Main Sta. (Zhengzhou)' },
    bearing: 'W',
    lat: 25.0478,
    lon: 121.517,
    routes: [],
  }
  const stationRoute = {
    routeName: { zh: '紅3', en: 'R3' },
    direction: 0,
    headsign: { zh: '往板橋', en: 'To Banqiao' },
    stopUid: 'TPE9',
  }

  it('maps API station and route fields to the arrival query', () => {
    const loc = arrivalFromStation(station, stationRoute, 'th', 'elder')
    expect(loc.path).toBe('/arrived')
    expect(loc.query).toEqual({
      lang: 'th',
      audience: 'elder',
      stationZh: '臺北車站(鄭州)',
      stationEn: 'Taipei Main Sta. (Zhengzhou)',
      routeZh: '紅3',
      routeEn: 'R3',
      headsignZh: '往板橋',
      headsignEn: 'To Banqiao',
    })
  })

  it('round-trips through the query into the arrival screen text', () => {
    const { trip: back, lang, audience } = tripFromQuery(arrivalFromStation(station, stationRoute, 'zh-TW', 'visitor').query)
    expect(buildArrival(back, lang, audience).spoken).toBe('到了。等 紅3，往板橋方向')
  })

  it('leaves out the station coordinates', () => {
    const query = arrivalFromStation(station, stationRoute, 'en', 'visitor').query
    expect(JSON.stringify(query)).not.toMatch(/25\.04|121\.51|TPE/)
  })
})
