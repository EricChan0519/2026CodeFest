import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Station } from '../contract'
import { isForeignQuery, localizeNames, pageLang, stopLabel } from '../foreignSearch'
import { api } from '../api'

const st = (zh: string, en: string | null): Station => ({ stationUid: zh, name: { zh, en }, bearing: null, lat: 25, lon: 121.5, routes: [] })

afterEach(() => vi.restoreAllMocks())

describe('isForeignQuery', () => {
  it('Korean, Thai, Khmer, kana and Latin words are foreign', () => {
    for (const q of ['대만박물관', 'พิพิธภัณฑ์', 'សារមន្ទីរ', 'バス停', 'Taipei Zoo', 'Bảo tàng Đài Loan']) expect(isForeignQuery(q)).toBe(true)
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
    ['捷運芝山站', { text: 'MRT 즈산역', isReading: false }],
    ['芝山岩', { text: '즈산옌', isReading: true }],
  ])
  it('English and Indonesian use the official TDX English name', () => {
    expect(stopLabel(st('捷運芝山站', 'MRT Zhishan Sta.'), 'en', labels)).toEqual({ text: 'MRT Zhishan Sta.', isReading: false })
  })
  it('other languages use the translation, then the official English name, then the reading', () => {
    expect(stopLabel(st('捷運芝山站', 'MRT Zhishan Sta.'), 'ko', labels)!.text).toBe('MRT 즈산역')
    expect(stopLabel(st('芝山岩', 'Zhishanyan'), 'ko', labels)!.text).toBe('Zhishanyan')
    expect(stopLabel(st('芝山岩', null), 'ko', labels)).toEqual({ text: '즈산옌', isReading: true })
  })
})

describe('localizeNames', () => {
  it('asks once per name and keeps translations and readings apart', async () => {
    const spy = vi.spyOn(api, 'translateNames').mockResolvedValue({
      lang: 'id',
      names: [
        { zh: '國立臺灣博物館', text: 'Museum Nasional Taiwan', reading: null },
        { zh: '臺北榮民總醫院', text: null, reading: 'Tai Bei Rong Min Zong Yi Yuan' },
      ],
    })
    const m = await localizeNames('id', ['國立臺灣博物館', '臺北榮民總醫院', '國立臺灣博物館'])
    expect(m.get('國立臺灣博物館')).toEqual({ text: 'Museum Nasional Taiwan', isReading: false })
    expect(m.get('臺北榮民總醫院')).toEqual({ text: 'Tai Bei Rong Min Zong Yi Yuan', isReading: true })
    await localizeNames('id', ['國立臺灣博物館'])
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('a failed request just leaves names in Chinese', async () => {
    vi.spyOn(api, 'translateNames').mockRejectedValue(new Error('down'))
    expect((await localizeNames('th', ['天母'])).size).toBe(0)
  })
})
