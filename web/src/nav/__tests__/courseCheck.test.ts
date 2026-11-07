import { describe, expect, it } from 'vitest'
import { NAV_CONFIG } from '../config'
import { createCourseCheck } from '../courseCheck'
import { pt } from '../__fixtures__/routes'

/** 沿正北每秒走 1.4 m，每秒一筆定位、朝向固定為 headingDeg */
function walkNorth(headingDeg: number, seconds: number, opts: { accuracyM?: number; start?: number } = {}) {
  const c = createCourseCheck(NAV_CONFIG)
  let t = 0
  const start = opts.start ?? 0
  for (let i = 0; i <= seconds; i++) {
    t += 1000
    for (let k = 0; k < 5; k++) c.pushHeading(headingDeg)
    const [lat, lon] = pt(0, start + i * 1.4)
    c.pushPosition({ lat, lon, accuracyM: opts.accuracyM ?? 8 }, t)
  }
  return c
}

describe('courseCheck', () => {
  it('stays unknown until enough samples', () => {
    expect(walkNorth(0, 10).verdict).toBe('unknown')
  })

  it('compass agrees with the walking direction -> ok', () => {
    const c = walkNorth(5, 60)
    expect(c.verdict).toBe('ok')
  })

  it('compass points 90° away from the walking direction -> suspect', () => {
    const c = walkNorth(90, 60)
    expect(c.verdict).toBe('suspect')
    expect(c.offsetDeg!).toBeCloseTo(-90, -1)
  })

  it('recovers to ok after the compass is fixed', () => {
    const c = walkNorth(90, 40)
    expect(c.verdict).toBe('suspect')
    c.clearSamples()
    let t = 100_000
    for (let i = 0; i <= 60; i++) {
      t += 1000
      for (let k = 0; k < 5; k++) c.pushHeading(0)
      const [lat, lon] = pt(0, 200 + i * 1.4)
      c.pushPosition({ lat, lon, accuracyM: 8 }, t)
    }
    expect(c.verdict).toBe('ok')
  })

  it('ignores poor GPS accuracy', () => {
    expect(walkNorth(90, 60, { accuracyM: 40 }).verdict).toBe('unknown')
  })

  it('ignores samples where the heading swung around (turning while walking)', () => {
    const c = createCourseCheck(NAV_CONFIG)
    let t = 0
    for (let i = 0; i <= 60; i++) {
      t += 1000
      c.pushHeading(i % 2 ? 0 : 180)
      const [lat, lon] = pt(0, i * 1.4)
      c.pushPosition({ lat, lon, accuracyM: 8 }, t)
    }
    expect(c.verdict).toBe('unknown')
  })

  it('ignores standing still (GPS drift)', () => {
    const c = createCourseCheck(NAV_CONFIG)
    let t = 0
    for (let i = 0; i <= 120; i++) {
      t += 1000
      c.pushHeading(90)
      const [lat, lon] = pt(i % 2 ? 2 : 0, 0)
      c.pushPosition({ lat, lon, accuracyM: 8 }, t)
    }
    expect(c.verdict).toBe('unknown')
  })

  it('reset clears everything', () => {
    const c = walkNorth(90, 60)
    c.reset()
    expect(c.verdict).toBe('unknown')
    expect(c.offsetDeg).toBeNull()
  })
})
