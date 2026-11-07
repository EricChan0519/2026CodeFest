import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceM, projectToSegment } from '../geo'
import { ORIGIN, pt } from '../__fixtures__/routes'

describe('distanceM', () => {
  it('is 0 for the same point', () => {
    expect(distanceM(ORIGIN, ORIGIN)).toBe(0)
  })
  it('matches local offsets within 0.5 m', () => {
    expect(distanceM(pt(0, 0), pt(0, 100))).toBeCloseTo(100, 0)
    expect(distanceM(pt(0, 0), pt(30, 40))).toBeCloseTo(50, 0)
  })
})

describe('bearingDeg', () => {
  it('cardinal directions', () => {
    expect(bearingDeg(pt(0, 0), pt(0, 100))).toBeCloseTo(0, 1)
    expect(bearingDeg(pt(0, 0), pt(100, 0))).toBeCloseTo(90, 1)
    expect(bearingDeg(pt(0, 0), pt(0, -100))).toBeCloseTo(180, 1)
    expect(bearingDeg(pt(0, 0), pt(-100, 0))).toBeCloseTo(270, 1)
  })
})

describe('projectToSegment', () => {
  it('projects onto the middle of a segment', () => {
    const r = projectToSegment(pt(5, 40), pt(0, 0), pt(0, 100))
    expect(r.t).toBeCloseTo(0.4, 2)
    expect(r.distM).toBeCloseTo(5, 0)
  })
  it('clamps to the segment ends', () => {
    expect(projectToSegment(pt(0, -20), pt(0, 0), pt(0, 100)).t).toBe(0)
    expect(projectToSegment(pt(0, 150), pt(0, 0), pt(0, 100)).t).toBe(1)
  })
  it('handles a zero-length segment', () => {
    const r = projectToSegment(pt(3, 4), pt(0, 0), pt(0, 0))
    expect(r.t).toBe(0)
    expect(r.distM).toBeCloseTo(5, 0)
  })
})
