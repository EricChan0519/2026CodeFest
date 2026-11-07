import { describe, expect, it } from 'vitest'
import { buildPoiIndex, formatDistance, normalizePoi, searchPois } from '../poiSearch'
import type { PoiFile } from '../poiSearch'

const data: PoiFile = {
  release: '2026-10-21.0',
  updatedAt: '2026-11-07T00:00:00+08:00',
  brands: [
    { key: '7-11', zh: '7-ELEVEN', en: '7-ELEVEN', kind: 'store', aliases: ['7-11', '統一超商', '小七'] },
    { key: 'familymart', zh: '全家', en: 'FamilyMart', kind: 'store', aliases: ['全家', 'family'] },
    { key: 'haidilao', zh: '海底撈', en: 'Haidilao', kind: 'food', aliases: ['海底撈', '火鍋'] },
    { key: 'mcdonalds', zh: '麥當勞', en: "McDonald's", kind: 'food', aliases: ['麥當勞', 'mcd'] },
    { key: 'okmart', zh: 'OK超商', en: 'OK mart', kind: 'store', aliases: ['ok'] },
  ],
  places: [
    // 臺北車站附近
    [1, '全家便利商店 北車店', 25.0478, 121.517, '忠孝西路一段49號', 90],
    [0, '7-ELEVEN 北門門市', 25.0492, 121.5105, '鄭州路1號', 95],
    [2, '海底撈火鍋 台北承德店', 25.0493, 121.5171, '承德路一段1號', 99],
    [2, '海底撈火鍋 板橋店', 25.0135, 121.4666, '新站路28號', 94],
    [2, '海底撈火鍋 新竹店', 24.802, 120.9646, '西大路323號', 90],
    [3, '麥當勞 信義店', 25.033, 121.5654, '信義路五段7號', 80],
    [3, '麥當勞 西門店', 25.0421, 121.5081, '成都路10號', 85],
    [1, '全家便利商店 信義店', 25.0335, 121.5651, '信義路五段8號', 88],
    [4, 'OK超商 中山店', 25.0527, 121.5205, '中山北路一段2號', 70],
  ],
}
const index = buildPoiIndex(data)
const TAIPEI_STATION: [number, number] = [25.0478, 121.517]

describe('normalizePoi', () => {
  it('unifies 台/臺, drops hyphens and apostrophes, lowercases', () => {
    expect(normalizePoi('7-11')).toBe('711')
    expect(normalizePoi("McDonald's")).toBe('mcdonalds')
    expect(normalizePoi(' 台北 ')).toBe('臺北')
  })
})

describe('searchPois', () => {
  it('lists every branch of a brand, nearest first', () => {
    const hits = searchPois(index, '海底撈', { near: TAIPEI_STATION })
    expect(hits.map((h) => h.name)).toEqual(['海底撈火鍋 台北承德店', '海底撈火鍋 板橋店', '海底撈火鍋 新竹店'])
    expect(hits[0]!.distanceM).toBeLessThan(200)
    expect(hits[2]!.distanceM).toBeGreaterThan(50000)
  })

  it('matches brand aliases and spelling variants', () => {
    expect(searchPois(index, '711', { near: TAIPEI_STATION })[0]!.brand.key).toBe('7-11')
    expect(searchPois(index, '7-ELEVEN')[0]!.brand.key).toBe('7-11')
    expect(searchPois(index, '統一超商')[0]!.brand.key).toBe('7-11')
    expect(searchPois(index, 'mcdonald')[0]!.brand.key).toBe('mcdonalds')
    expect(searchPois(index, 'FamilyMart')[0]!.brand.key).toBe('familymart')
    expect(searchPois(index, 'OK')[0]!.brand.key).toBe('okmart')
  })

  it('treats the rest of the query as a name/address filter', () => {
    const hits = searchPois(index, '麥當勞 信義', { near: TAIPEI_STATION })
    expect(hits.map((h) => h.name)).toEqual(['麥當勞 信義店'])
    // 沒空白也行
    expect(searchPois(index, '全家信義').map((h) => h.name)).toEqual(['全家便利商店 信義店'])
    // 地址也算
    expect(searchPois(index, '全家 忠孝西路').map((h) => h.name)).toEqual(['全家便利商店 北車店'])
  })

  it('sorts by confidence when there is no reference point', () => {
    const hits = searchPois(index, '麥當勞')
    expect(hits.map((h) => h.confidence)).toEqual([85, 80])
    expect(hits[0]!.distanceM).toBeNull()
  })

  it('falls back to a name substring when there is no brand', () => {
    expect(searchPois(index, '承德店').map((h) => h.name)).toEqual(['海底撈火鍋 台北承德店'])
    expect(searchPois(index, '臺北承德').map((h) => h.name)).toEqual(['海底撈火鍋 台北承德店'])
  })

  it('respects the limit and ignores too-short or unknown queries', () => {
    expect(searchPois(index, '海底撈', { limit: 2 })).toHaveLength(2)
    expect(searchPois(index, '')).toEqual([])
    expect(searchPois(index, '店')).toEqual([])
    expect(searchPois(index, '完全不存在的店名')).toEqual([])
  })
})

describe('formatDistance', () => {
  it('uses meters under 1 km and kilometers above', () => {
    expect(formatDistance(null)).toBe('')
    expect(formatDistance(4)).toBe('10 公尺')
    expect(formatDistance(347)).toBe('350 公尺')
    expect(formatDistance(2431)).toBe('2.4 公里')
    expect(formatDistance(58000)).toBe('58 公里')
  })
})
