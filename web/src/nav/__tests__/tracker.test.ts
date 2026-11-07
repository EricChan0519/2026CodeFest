import { describe, expect, it } from 'vitest'
import { NAV_CONFIG } from '../config'
import { distanceM } from '../geo'
import { createTracker } from '../tracker'
import { HAIRPIN, L_END, L_SHAPE, L_TURN_POINT, SINGLE_POINT, STRAIGHT, pt } from '../__fixtures__/routes'

/** 一步一步走過去，模擬真實的連續定位（每步不超過搜尋視窗） */
function walk(tr: ReturnType<typeof createTracker>, points: [number, number][]) {
  let last
  for (const [e, n] of points) last = tr.update(pt(e, n))
  return last!
}

describe('tracker', () => {
  it('reports position along the route and remaining distance', () => {
    const t = createTracker(STRAIGHT, NAV_CONFIG).update(pt(2, 50))
    expect(t.alongM).toBeCloseTo(50, 0)
    expect(t.remainingM).toBeCloseTo(150, 0)
    expect(t.offRouteM).toBeCloseTo(2, 0)
  })

  it('looks ahead lookaheadM along the route', () => {
    const t = createTracker(STRAIGHT, NAV_CONFIG).update(pt(0, 50))
    expect(distanceM(t.target, pt(0, 70))).toBeLessThan(1)
  })

  it('target is the turn point 5 m before the turn, never cutting the corner', () => {
    const t = createTracker(L_SHAPE, NAV_CONFIG).update(pt(0, 95))
    expect(distanceM(t.target, L_TURN_POINT)).toBeLessThan(0.5)
    expect(t.nextTurn?.kind).toBe('right')
    expect(t.nextTurn?.distanceM).toBeCloseTo(5, 0)
  })

  it('target goes past the corner once it is passed', () => {
    const t = walk(createTracker(L_SHAPE, NAV_CONFIG), [[0, 50], [0, 95], [5, 100]])
    expect(t.nextTurn?.kind).toBe('arrive') // 轉角已過，下一個是終點
    expect(distanceM(t.target, pt(25, 100))).toBeLessThan(1)
  })

  it('target is clamped to the end of the route', () => {
    const t = walk(createTracker(STRAIGHT, NAV_CONFIG), [[0, 90], [0, 180], [0, 195]])
    expect(distanceM(t.target, pt(0, 200))).toBeLessThan(0.5)
    expect(t.remainingM).toBeCloseTo(5, 0)
  })

  it('does not jump back to a walked segment', () => {
    const tr = createTracker(HAIRPIN, NAV_CONFIG)
    const far = walk(tr, [[0, 90], [0, 140]])
    expect(far.alongM).toBeCloseTo(140, 0)
    // GPS 跳到第二段（只差 4 公尺）的起點附近，那一段在前面 150+ 公尺之外
    const jumped = tr.update(pt(4, 10))
    expect(jumped.alongM).toBeGreaterThanOrEqual(far.alongM)
  })

  it('never goes backwards on a noisy fix behind the user', () => {
    const tr = createTracker(STRAIGHT, NAV_CONFIG)
    const a = tr.update(pt(0, 80)).alongM
    const b = tr.update(pt(0, 70)).alongM
    expect(b).toBeGreaterThanOrEqual(a)
  })

  it('reports a large off-route distance when far from the path', () => {
    const t = createTracker(STRAIGHT, NAV_CONFIG).update(pt(60, 50))
    expect(t.offRouteM).toBeGreaterThan(55)
  })

  it('measures distance to the end point directly', () => {
    const t = createTracker(L_SHAPE, NAV_CONFIG).update(pt(90, 100))
    expect(t.distToEndM).toBeCloseTo(distanceM(pt(90, 100), L_END), 3)
    expect(t.distToEndM).toBeCloseTo(10, 0)
  })

  it('handles a single-point route', () => {
    const t = createTracker(SINGLE_POINT, NAV_CONFIG).update(pt(0, 0))
    expect(t.remainingM).toBe(0)
    expect(t.distToEndM).toBeCloseTo(0, 3)
    expect(t.nextTurn).toBeNull()
  })

  it('handles an empty geometry without throwing', () => {
    expect(() => createTracker({ geometry: [], maneuvers: [] }, NAV_CONFIG).update(pt(0, 0))).not.toThrow()
  })
})
