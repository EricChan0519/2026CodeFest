/**
 * 04：重算失敗只能帶人回原路線，不准畫直線到終點。
 * 掃描所有原始碼，確保沒有任何地方再用「直線連到終點」的路線。
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.vue', '!/src/**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no straight-line reroute', () => {
  it('scans the app sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
  })

  it('nothing defines or calls straightRoute()', () => {
    const hits = Object.entries(sources)
      .filter(([, code]) => /straightRoute\s*\(/.test(code))
      .map(([file]) => file)
    expect(hits).toEqual([])
  })
})
