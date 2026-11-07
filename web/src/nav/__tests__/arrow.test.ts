import { describe, expect, it } from 'vitest'
import { alphaForDt, arrowAngle, directionKey, easeRotation, nextCssRotation, smoothHeading } from '../arrow'

describe('smoothHeading', () => {
  it('smooths across north (359 and 1 stay near 0, not 180)', () => {
    const a = smoothHeading(null, 359, 0.2)
    const b = smoothHeading(a, 1, 0.2)
    expect(Math.min(b.deg, 360 - b.deg)).toBeLessThan(2)
  })

  it('first sample is used as is', () => {
    expect(smoothHeading(null, 123, 0.2).deg).toBeCloseTo(123)
  })

  it('converges to a steady heading', () => {
    let h = smoothHeading(null, 0, 0.2)
    for (let i = 0; i < 60; i++) h = smoothHeading(h, 90, 0.2)
    expect(h.deg).toBeCloseTo(90, 0)
  })
})

describe('arrowAngle', () => {
  it('is bearing minus heading, wrapped', () => {
    expect(arrowAngle(10, 350)).toBe(20)
    expect(arrowAngle(350, 10)).toBe(340)
    expect(arrowAngle(90, 90)).toBe(0)
  })
})

describe('nextCssRotation', () => {
  it('rotates the short way: 350 to 10 is +20', () => {
    expect(nextCssRotation(350, 10)).toBe(370)
  })
  it('rotates back the short way: 10 to 350 is -20', () => {
    expect(nextCssRotation(10, 350)).toBe(-10)
  })
  it('works when current is beyond 360', () => {
    expect(nextCssRotation(370, 20)).toBe(380)
    expect(nextCssRotation(370, 350)).toBe(350)
  })
  it('never turns more than 180', () => {
    for (let c = -400; c < 800; c += 37) {
      for (let t = 0; t < 360; t += 13) {
        expect(Math.abs(nextCssRotation(c, t) - c)).toBeLessThanOrEqual(180)
      }
    }
  })
})

describe('directionKey', () => {
  it.each([
    [0, 'straight'],
    [24, 'straight'],
    [336, 'straight'],
    [30, 'bear_right'],
    [330, 'bear_left'],
    [90, 'right'],
    [270, 'left'],
    [150, 'right'],
    [151, 'turn_around'],
    [209, 'turn_around'],
    [210, 'left'],
    [180, 'turn_around'],
  ])('%d -> %s', (angle, key) => {
    expect(directionKey(angle)).toBe(key)
  })
})

describe('alphaForDt', () => {
  it('is 0 for no elapsed time and approaches 1 for long gaps', () => {
    expect(alphaForDt(0, 80)).toBe(0)
    expect(alphaForDt(10_000, 80)).toBeCloseTo(1)
  })
  it('matches the old 0.2-per-event feel at 60 Hz', () => {
    expect(alphaForDt(1000 / 60, 80)).toBeGreaterThan(0.15)
    expect(alphaForDt(1000 / 60, 80)).toBeLessThan(0.25)
  })
})

describe('easeRotation', () => {
  it('moves part of the way per frame and never overshoots', () => {
    const r = easeRotation(0, 100, 16, 50)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(100)
  })
  it('snaps when close enough', () => {
    expect(easeRotation(99.95, 100, 16, 50)).toBe(100)
  })
  it('reaches the target within a few time constants', () => {
    let r = 0
    for (let i = 0; i < 20; i++) r = easeRotation(r, 90, 16, 50) // 320 ms
    expect(r).toBeGreaterThan(89)
  })
})
