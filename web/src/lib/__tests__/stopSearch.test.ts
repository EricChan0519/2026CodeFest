import { describe, expect, it } from 'vitest'
import type { Station } from '../contract'
import { buildStopIndex, normalizeQuery, queryVariants, searchStops } from '../stopSearch'

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

  it('respects the limit and returns nothing for unknown names', () => {
    expect(searchStops(index, '北', 1)).toHaveLength(1)
    expect(searchStops(index, '不存在的站')).toEqual([])
  })
})
