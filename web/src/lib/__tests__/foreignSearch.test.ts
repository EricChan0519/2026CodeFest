import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Station } from '../contract'
import { isForeignQuery, localizeResults, pageLang, poiNameForTranslation, stopLabel } from '../foreignSearch'
import { api } from '../api'

const st = (zh: string, en: string | null): Station => ({ stationUid: zh, name: { zh, en }, bearing: null, lat: 25, lon: 121.5, routes: [] })

afterEach(() => vi.restoreAllMocks())

describe('isForeignQuery', () => {
  it('Korean, Thai, kana and Latin words are foreign', () => {
    for (const q of ['대만박물관', 'พิพิธภัณฑ์', 'バス停', 'Taipei Zoo', 'Bảo tàng Đài Loan']) expect(isForeignQuery(q)).toBe(true)
  })
  it('Japanese kanji or simplified characters need converting too', () => {
    for (const q of ['士林駅', '台湾大学', '台北动物园']) expect(isForeignQuery(q)).toBe(true)
  })
  it('Chinese, Chinese with a little English, numbers and coordinates are not', () => {
    for (const q of ['臺北車站', 'MRT 芝山', '7-11', '25.1172, 121.5346', '全家 芝山']) expect(isForeignQuery(q)).toBe(false)
  })
})

describe('pageLang', () => {
  it('reads ?lang= and ignores Chinese or unknown values', () => {
    expect(pageLang('?lang=ko')).toBe('ko')
    expect(pageLang('?lang=zh-TW')).toBeNull()
    expect(pageLang('?lang=xx')).toBeNull()
    expect(pageLang('')).toBeNull()
  })
})

describe('stopLabel', () => {
  const labels = new Map([
    ['捷運芝山站', { text: 'MRT 즈산역', approx: false }],
    ['芝山岩', { text: '즈산옌', approx: true }],
  ])
  it('English uses the official TDX English name', () => {
    expect(stopLabel(st('捷運芝山站', 'MRT Zhishan Sta.'), 'en', labels)).toEqual({ text: 'MRT Zhishan Sta.', approx: false })
  })
  it('other languages use the translation; a spelled-out name also gets the official English name', () => {
    expect(stopLabel(st('捷運芝山站', 'MRT Zhishan Sta.'), 'ko', labels)!.text).toBe('MRT 즈산역')
    expect(stopLabel(st('芝山岩', 'Zhishanyan'), 'ko', labels)!.text).toBe('즈산옌 · Zhishanyan')
    expect(stopLabel(st('芝山岩', null), 'ko', labels)).toEqual({ text: '즈산옌', approx: true })
  })
})

describe('localizeResults', () => {
  it('asks once per item and returns names, addresses and categories', async () => {
    const spy = vi.spyOn(api, 'translateNames').mockResolvedValue({
      lang: 'ko',
      names: [
        { zh: '國立臺灣博物館', text: '국립대만박물관', exact: true },
        { zh: '台北車站雄獅站前門市', text: '타이베이역 슝스 역 앞 매장', exact: false },
      ],
      addresses: [{ zh: '忠孝西路一段3號', text: '중샤오시루 1단 3호' }],
      categories: [{ zh: '餐廳', text: '식당' }],
    })
    const r = await localizeResults('ko', {
      names: ['國立臺灣博物館', '台北車站雄獅站前門市', '國立臺灣博物館'],
      addresses: ['忠孝西路一段3號'],
      categories: ['餐廳'],
    })
    expect(r.names.get('國立臺灣博物館')).toEqual({ text: '국립대만박물관', approx: false })
    expect(r.names.get('台北車站雄獅站前門市')).toEqual({ text: '타이베이역 슝스 역 앞 매장', approx: true })
    expect(r.addresses.get('忠孝西路一段3號')).toBe('중샤오시루 1단 3호')
    expect(r.categories.get('餐廳')).toBe('식당')
    await localizeResults('ko', { names: ['國立臺灣博物館'], addresses: ['忠孝西路一段3號'], categories: ['餐廳'] })
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('a failed request just leaves things in Chinese', async () => {
    vi.spyOn(api, 'translateNames').mockRejectedValue(new Error('down'))
    expect((await localizeResults('th', { names: ['天母'] })).names.size).toBe(0)
  })
})

describe('poiNameForTranslation', () => {
  const brand = { key: 'starbucks', zh: '星巴克', en: 'Starbucks', kind: 'cafe' as const, aliases: ['統一星巴克'] }
  it('puts the English brand name in place of the Chinese one', () => {
    expect(poiNameForTranslation('台北車站二樓星巴克', brand)).toBe('台北車站二樓 Starbucks')
    expect(poiNameForTranslation('統一星巴克 天母店', brand)).toBe('Starbucks 天母店')
    expect(poiNameForTranslation('天母店', brand)).toBe('天母店')
  })
})
