import { describe, expect, it } from 'vitest'
import { metroLineName } from '../metroLines'
import { routeName } from '@/nav/navText'

describe('official MRT line names (2026-11-08)', () => {
  it('Korean and Japanese use Taipei Metro names', () => {
    expect(metroLineName('淡水信義線', 'ko')).toBe('단수이신이선')
    expect(metroLineName('環狀線', 'ja')).toBe('環状線')
  })
  it('other languages and bus routes keep the normal rule (official English from the data)', () => {
    expect(metroLineName('淡水信義線', 'en')).toBeNull()
    expect(metroLineName('307', 'ko')).toBeNull()
    expect(routeName({ zh: '板南線', en: 'Bannan Line' }, 'ko')).toBe('반난선')
    expect(routeName({ zh: '板南線', en: 'Bannan Line' }, 'vi')).toBe('Bannan Line')
    expect(routeName({ zh: '307', en: '307' }, 'ko')).toBe('307')
  })
})
