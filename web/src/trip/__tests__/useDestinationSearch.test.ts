import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@/lib/locator'
import type { Station } from '@/lib/contract'

const { station } = vi.hoisted(() => ({
  station: (uid: string, zh: string, en: string): Station => ({ stationUid: uid, name: { zh, en }, bearing: null, lat: 25.1025, lon: 121.5225, routes: [] }),
}))

vi.mock('@/lib/stopSearch', async (orig) => {
  const real = await orig<typeof import('@/lib/stopSearch')>()
  const idx = real.buildStopIndex({
    updatedAt: '2026-11-08',
    stations: [station('Z1', '捷運芝山站(福國)', 'MRT Zhishan Sta. (Fuguo)'), station('X1', '芝山岩', 'Zhishanyan')],
  })
  return { ...real, loadStopIndex: vi.fn().mockResolvedValue(idx) }
})
vi.mock('@/lib/poiSearch', async (orig) => {
  const real = await orig<typeof import('@/lib/poiSearch')>()
  return { ...real, loadPoiIndex: vi.fn().mockResolvedValue(real.buildPoiIndex({ release: 't', updatedAt: 't', brands: [], places: [] })) }
})
vi.mock('@/lib/geocode', async (orig) => ({ ...(await orig<typeof import('@/lib/geocode')>()), searchPlaces: vi.fn().mockResolvedValue([]) }))

import { api } from '@/lib/api'
import { useDestinationSearch } from '../useDestinationSearch'

const locator: Locator = {
  start: () => {},
  stop: () => {},
  feed: () => {},
  latest: () => [25.0478, 121.517],
  current: async () => [25.0478, 121.517],
} as unknown as Locator

afterEach(() => vi.restoreAllMocks())

describe('useDestinationSearch: foreign queries on the main screen (2026-11-08: 즈산역 found nothing)', () => {
  it('translates to Chinese first, searches with it, and labels results in the chosen language', async () => {
    vi.spyOn(api, 'translateQuery').mockResolvedValue({
      lang: 'ko',
      queries: ['芝山站'],
      partial: false,
      segments: [],
    })
    vi.spyOn(api, 'landmarks').mockResolvedValue({ places: [], source: { name: 'x', release: null, license: null, updatedAt: null } })
    const names = vi.spyOn(api, 'translateNames').mockResolvedValue({
      lang: 'ko',
      names: [{ zh: '捷運芝山站(福國)', text: 'MRT 즈산역 (푸궈)', exact: true }],
      addresses: [],
      categories: [],
    })
    const s = useDestinationSearch(locator, () => 'ko')
    await s.search('즈산역')
    expect(s.translation.value?.to).toBe('芝山站')
    expect(s.stops.value.map((x) => x.stationUid)).toContain('Z1')
    await vi.waitFor(() => expect(s.labels.value.names.get('捷運芝山站(福國)')?.text).toBe('MRT 즈산역 (푸궈)'))
    expect(names).toHaveBeenCalledWith('ko', expect.arrayContaining(['捷運芝山站(福國)']), expect.any(Array), expect.any(Array))
  })

  it('Chinese queries are not sent for translation and stay in Chinese with a Chinese UI', async () => {
    const tq = vi.spyOn(api, 'translateQuery')
    vi.spyOn(api, 'landmarks').mockResolvedValue({ places: [], source: { name: 'x', release: null, license: null, updatedAt: null } })
    const s = useDestinationSearch(locator, () => 'zh-TW')
    await s.search('芝山站')
    expect(tq).not.toHaveBeenCalled()
    expect(s.displayLang.value).toBeNull()
    expect(s.stops.value.map((x) => x.stationUid)).toContain('Z1')
  })
})
