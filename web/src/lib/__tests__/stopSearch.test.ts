import { describe, expect, it } from 'vitest'
import type { Station } from '../contract'
import { buildStopIndex, groupStops, normalizeQuery, queryVariants, searchStops } from '../stopSearch'

const st = (uid: string, zh: string, en: string | null, bearing: string | null = null): Station => ({
  stationUid: uid,
  name: { zh, en },
  bearing,
  lat: 25,
  lon: 121.5,
  routes: [],
})

const index = buildStopIndex({
  updatedAt: '2026-11-07T00:00:00+08:00',
  stations: [
    st('A1', '市立臺北特教學校', 'Taipei Municipal School of Special Education', 'SW'),
    st('A2', '市立臺北特教學校', 'Taipei Municipal School of Special Education', 'N'),
    st('B1', '臺北車站', 'Taipei Main Station'),
    st('B2', '臺北車站(忠孝)', null),
    st('C1', '天母', 'Tianmu'),
    st('D1', '天母運動公園', null),
    st('E1', '板橋', 'Banqiao'),
  ],
})

describe('normalizeQuery', () => {
  it('unifies 台/臺, trims spaces, lowercases', () => {
    expect(normalizeQuery(' 台北 車站 ')).toBe('臺北車站')
    expect(normalizeQuery('Tianmu')).toBe('tianmu')
  })
})

describe('queryVariants', () => {
  it('strips trailing 公車站 / 站牌 / 公車 as an extra variant', () => {
    expect(queryVariants('市立臺北特教學校公車站')).toEqual(['市立臺北特教學校公車站', '市立臺北特教學校'])
    expect(queryVariants('天母站牌')).toEqual(['天母站牌', '天母'])
    expect(queryVariants('天母')).toEqual(['天母'])
  })
  it('keeps a query that is only the suffix', () => {
    expect(queryVariants('公車站')).toContain('公車站')
  })
  it('empty gives nothing', () => {
    expect(queryVariants('  ')).toEqual([])
  })
})

describe('searchStops', () => {
  it('finds the bus stop even when the user types 公車站 (the case Google found and OSM did not)', () => {
    const r = searchStops(index, '市立臺北特教學校公車站')
    expect(r.map((s) => s.stationUid)).toEqual(['A1', 'A2']) // 兩個方向都列出
  })

  it('matches parts of the name and English names', () => {
    expect(searchStops(index, '特教').map((s) => s.stationUid)).toEqual(['A1', 'A2'])
    expect(searchStops(index, 'banqiao').map((s) => s.stationUid)).toEqual(['E1'])
  })

  it('台 and 臺 are the same', () => {
    expect(searchStops(index, '台北車站').map((s) => s.stationUid)).toEqual(['B1', 'B2'])
  })

  it('ranks exact name, then prefix, then contains', () => {
    expect(searchStops(index, '天母').map((s) => s.stationUid)).toEqual(['C1', 'D1'])
    expect(searchStops(index, '運動公園').map((s) => s.stationUid)).toEqual(['D1'])
  })

  it('same match quality: nearest stop first, and it follows the user', () => {
    const far = { ...st('F1', '天母國小', null), lat: 25.05, lon: 121.52 }
    const near = { ...st('F2', '天母國中', null), lat: 25.118, lon: 121.537 }
    const idx = buildStopIndex({ updatedAt: '', stations: [far, near] })
    expect(searchStops(idx, '天母國', 20, [25.115, 121.536]).map((s) => s.stationUid)).toEqual(['F2', 'F1'])
    expect(searchStops(idx, '天母國', 20, [25.0478, 121.517]).map((s) => s.stationUid)).toEqual(['F1', 'F2'])
  })

  it('better name match still wins over distance', () => {
    const exactFar = { ...st('G1', '天母', null), lat: 25.05, lon: 121.52 }
    const containsNear = { ...st('G2', '天母運動公園', null), lat: 25.115, lon: 121.536 }
    const idx = buildStopIndex({ updatedAt: '', stations: [containsNear, exactFar] })
    expect(searchStops(idx, '天母', 20, [25.115, 121.536]).map((s) => s.stationUid)).toEqual(['G1', 'G2'])
  })

  it('respects the limit and returns nothing for unknown names', () => {
    expect(searchStops(index, '北', 1)).toHaveLength(1)
    expect(searchStops(index, '不存在的站')).toEqual([])
  })
})

describe('groupStops (2026-11-08: one row per stop name)', () => {
  const route = (no: string, headsign: string, stopUid: string) => ({
    routeName: { zh: no, en: no },
    direction: 0,
    headsign: { zh: headsign, en: null },
    stopUid,
  })
  const st = (uid: string, zh: string, lat: number, lon: number, routes: ReturnType<typeof route>[]) => ({
    stationUid: uid,
    name: { zh, en: null },
    bearing: 'N',
    lat,
    lon,
    routes,
  })
  const near: [number, number] = [25.104, 121.522]
  const a = st('A', '捷運芝山站(福華)', 25.1041, 121.5223, [route('紅68', '往捷運芝山站', 'a1')])
  const b = st('B', '捷運芝山站(福國)', 25.1019, 121.5243, [route('267', '往天母', 'b1'), route('606', '往萬芳社區', 'b2')])
  const c = st('C', '捷運芝山站(福國)', 25.102, 121.5244, [route('267', '往天母', 'c1'), route('267', '往松山', 'c2')])
  const far = st('D', '捷運芝山站(福華)', 25.2, 121.6, [route('9', '往X', 'd1')])
  const other = st('E', '芝山岩', 25.103, 121.53, [])

  it('merges same-name stops nearby, ignoring the street in brackets', () => {
    const g = groupStops([a, b, c, other], near)
    expect(g.map((x) => x.name.zh)).toEqual(['捷運芝山站', '芝山岩'])
    expect(g[0]!.stations.map((s) => s.stationUid).sort()).toEqual(['A', 'B', 'C'])
  })

  it('each route keeps the stop it actually leaves from; same route and direction only once', () => {
    const [g] = groupStops([a, b, c], near)
    const rows = g!.routes.map((r) => `${r.route.routeName.zh}${r.route.headsign.zh}@${r.station.stationUid}`)
    expect(rows).toHaveLength(4)
    expect(rows).toContain('267往松山@C')
    expect(rows.filter((r) => r.startsWith('267往天母'))).toHaveLength(1)
  })

  it('keeps the name as is when every stop has the same name', () => {
    expect(groupStops([b, c], near)[0]!.name.zh).toBe('捷運芝山站(福國)')
  })

  it('does not merge far-apart stops with the same name', () => {
    expect(groupStops([a, far], near)).toHaveLength(2)
  })
})
