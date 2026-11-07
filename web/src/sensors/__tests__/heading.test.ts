import { describe, expect, it } from 'vitest'
import { headingFromOrientation, toTrueNorth } from '../heading'

describe('headingFromOrientation', () => {
  it('flat: uses top edge (360 - alpha)', () => {
    expect(headingFromOrientation(90, 0, 0)).toBeCloseTo(270)
    expect(headingFromOrientation(0, 0, 0)).toBeCloseTo(0)
    expect(headingFromOrientation(270, 10, 5)).toBeCloseTo(90)
  })

  it('upright: uses back of phone', () => {
    expect(headingFromOrientation(0, 90, 0)).toBeCloseTo(0)
    expect(headingFromOrientation(90, 90, 0)).toBeCloseTo(270)
    expect(headingFromOrientation(180, 90, 0)).toBeCloseTo(180)
  })

  it('has no jump when beta crosses the old hard switch at 60°', () => {
    const jump = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
    for (const [alpha, gamma] of [[30, 25], [200, -30], [310, 15]] as const) {
      let prev = headingFromOrientation(alpha, 40, gamma)
      for (let beta = 41; beta <= 85; beta++) {
        const h = headingFromOrientation(alpha, beta, gamma)
        expect(jump(h, prev)).toBeLessThan(6) // 每 1° beta 的變化要小
        prev = h
      }
    }
  })

  it('stays within 0-360', () => {
    for (let a = 0; a < 360; a += 15) {
      for (const b of [-80, -30, 0, 30, 80]) {
        const h = headingFromOrientation(a, b, 7)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
      }
    }
  })
})

describe('toTrueNorth', () => {
  it('wraps below zero', () => {
    expect(toTrueNorth(2, -4.7)).toBeCloseTo(357.3)
  })
  it('adds declination', () => {
    expect(toTrueNorth(100, -4.7)).toBeCloseTo(95.3)
  })
})
