import { describe, expect, it } from 'vitest'
import type { Station } from '../contract'
import { fuzzyScore, parseQuery } from '../fuzzy'
import { mrtAlternative } from '../geocode'
import { buildStopIndex, searchStops } from '../stopSearch'

const st = (uid: string, zh: string, en: string | null = null): Station => ({
  stationUid: uid,
  name: { zh, en },
  bearing: null,
  lat: 25,
  lon: 121.5,
  routes: [],
})

// 名稱照 TDX 快照的寫法
const index = buildStopIndex({
  updatedAt: '2026-11-07T00:00:00+08:00',
  stations: [
    st('Z1', '捷運芝山站(中山北路)', 'MRT Zhishan Sta.(Zhongshan N. Rd.)'),
    st('Z2', '捷運芝山站一', 'MRT Zhishan Sta.'),
    st('Z3', '芝山國小'),
    st('Z4', '芝山岩'),
    st('S1', '捷運士林站', 'MRT Shilin Sta.'),
    st('T1', '臺大', 'National Taiwan University'),
    st('T3', '臺灣科技大學'),
    st('T2', '臺大醫院'),
    st('P1', '天母運動公園'),
  ],
})
const uids = (q: string) => searchStops(index, q).map((s) => s.stationUid)

describe('fuzzy stop search', () => {
  it('芝山捷運站 finds 捷運芝山站, MRT stops before 芝山國小', () => {
    const r = uids('芝山捷運站')
    expect(r.slice(0, 2).sort()).toEqual(['Z1', 'Z2'])
    expect(r).toContain('Z3')
    expect(r.indexOf('Z1')).toBeLessThan(r.indexOf('Z3'))
  })

  it('other ways of saying it', () => {
    for (const q of ['芝山站', '捷運 芝山', '芝山 捷運站', '芝山mrt']) expect(uids(q).slice(0, 2).sort()).toEqual(['Z1', 'Z2'])
  })

  it('space-separated words in any order', () => {
    expect(uids('中山北路 芝山')[0]).toBe('Z1')
  })

  it('one typo in a longer name', () => {
    expect(uids('天母運動公圓')).toEqual(['P1'])
  })

  it('does not match scattered characters (臺灣大學 is not 臺灣科技大學)', () => {
    expect(uids('臺灣大學')).not.toContain('T3')
  })

  it('exact matches still come first and short noise is ignored', () => {
    expect(uids('捷運士林站')[0]).toBe('S1')
    expect(fuzzyScore(parseQuery('山'), '芝山國小')).toBe(0) // 一個字不做模糊（一般的「包含」照舊）
    expect(uids('國立臺灣大學')).not.toContain('T3')
  })

  it('fuzzyScore: latin letters must appear together', () => {
    expect(fuzzyScore(parseQuery('tianmu'), 'mrtzhishansta')).toBe(0)
  })
})

describe('mrtAlternative (OSM retry)', () => {
  it('rewrites MRT phrasing', () => {
    expect(mrtAlternative('芝山捷運站')).toBe('捷運芝山站')
    expect(mrtAlternative('捷運 芝山')).toBe('捷運芝山站')
    expect(mrtAlternative('芝山站 MRT')).toBe('捷運芝山站')
    expect(mrtAlternative('捷運芝山站')).toBe('芝山站')
    expect(mrtAlternative('天母')).toBeNull()
  })
})
