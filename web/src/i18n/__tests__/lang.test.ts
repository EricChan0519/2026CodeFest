import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANG_CHOICES, loadStoredLang, resolveLang, saveLang } from '../lang'

describe('resolveLang', () => {
  it('uses the language in the URL first, then the saved one', () => {
    expect(resolveLang('th', 'vi')).toBe('th')
    expect(resolveLang(undefined, 'vi')).toBe('vi')
  })

  it('ignores unknown values and asks the user to pick when nothing is known', () => {
    expect(resolveLang('xx', 'vi')).toBe('vi')
    expect(resolveLang(['th'], null)).toBeNull()
    expect(resolveLang(undefined, 'klingon')).toBeNull()
  })
})

describe('saved language', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remembers the choice on this phone', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    expect(loadStoredLang()).toBeNull()
    saveLang('id')
    expect(loadStoredLang()).toBe('id')
  })

  it('still works when storage is blocked (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => saveLang('id')).not.toThrow()
    expect(loadStoredLang()).toBeNull()
  })
})

describe('LANG_CHOICES', () => {
  it('lists all 8 languages, each named in its own language', () => {
    expect(LANG_CHOICES.map((c) => c.lang)).toEqual(['zh-TW', 'en', 'id', 'vi', 'th', 'km', 'ja', 'ko'])
    expect(LANG_CHOICES.find((c) => c.lang === 'th')!.name).toBe('ไทย')
  })
})
