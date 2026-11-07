import { describe, expect, it } from 'vitest'
import { NAV_CONFIG } from '../config'
import { distanceM } from '../geo'
import { createTracker } from '../tracker'
import {
  ACUTE_LEFT,
  ACUTE_TURN_POINT,
  HAIRPIN,
  LEFT_THEN_RIGHT,
  LR_FIRST_TURN,
  L_END,
  L_SHAPE,
  L_TURN_POINT,
  SINGLE_POINT,
  STRAIGHT,
  acuteLeg2,
  pt,
} from '../__fixtures__/routes'

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

  it('target is the turn point 10 m before the turn (outside turnPassM), never cutting the corner', () => {
    const t = createTracker(L_SHAPE, NAV_CONFIG).update(pt(0, 90))
    expect(distanceM(t.target, L_TURN_POINT)).toBeLessThan(0.5)
    expect(t.nextTurn?.kind).toBe('right')
    expect(t.nextTurn?.distanceM).toBeCloseTo(10, 0)
  })

  it('target goes past the corner once it is passed', () => {
    const t = walk(createTracker(L_SHAPE, NAV_CONFIG), [[0, 50], [0, 95], [5, 100]])
    expect(t.nextTurn).toBeNull() // 轉角已過；arrive 不算轉彎
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

  it('arrive is not a turn point', () => {
    expect(createTracker(STRAIGHT, NAV_CONFIG).update(pt(0, 190)).nextTurn).toBeNull()
  })
})

/** 04「箭頭依路徑轉彎」：目標點跟著路線的下一段走，過了轉角就換下一段 */
describe('tracker: turn by turn', () => {
  /** 每步都帶精度，模擬真實定位 */
  function walkAcc(tr: ReturnType<typeof createTracker>, points: [number, number][], accuracyM = 8) {
    let last
    for (const [e, n] of points) last = tr.update(pt(e, n), accuracyM)
    return last!
  }

  it('at the start of an L route the target is on the first leg, not toward the end', () => {
    const t = createTracker(LEFT_THEN_RIGHT, NAV_CONFIG).update(pt(0, 0), 8)
    expect(distanceM(t.target, pt(0, 20))).toBeLessThan(0.5)
    expect(t.nextTurn).toMatchObject({ kind: 'left', index: 6 })
    expect(t.nextTurn?.distanceM).toBeCloseTo(60, 0)
  })

  it('just outside turnPassM the target stays on the corner', () => {
    const t = walkAcc(createTracker(LEFT_THEN_RIGHT, NAV_CONFIG), [[0, 30], [0, 50]])
    expect(distanceM(t.target, LR_FIRST_TURN)).toBeLessThan(0.5)
    expect(t.nextTurn?.kind).toBe('left')
  })

  it('within turnPassM of the first corner the target moves to the second leg', () => {
    // 離轉角 7 公尺，turnPassM = max(8, 0.5 × 8) = 8
    const t = walkAcc(createTracker(LEFT_THEN_RIGHT, NAV_CONFIG), [[0, 30], [0, 53]])
    expect(distanceM(t.target, pt(-20, 60))).toBeLessThan(1)
    expect(t.nextTurn).toMatchObject({ kind: 'right', index: 12 })
    expect(t.nextTurn?.distanceM).toBeCloseTo(60, 0)
  })

  it('turnPassM grows with poor accuracy', () => {
    // 離轉角 12 公尺：精度 8 時還沒通過，精度 30（turnPassM 15）時算通過
    const good = walkAcc(createTracker(LEFT_THEN_RIGHT, NAV_CONFIG), [[0, 30], [0, 48]], 8)
    expect(good.nextTurn?.kind).toBe('left')
    const poor = walkAcc(createTracker(LEFT_THEN_RIGHT, NAV_CONFIG), [[0, 30], [0, 48]], 30)
    expect(poor.nextTurn?.kind).toBe('right')
  })

  it('a passed turn is never undone, even if GPS falls back before it', () => {
    const tr = createTracker(LEFT_THEN_RIGHT, NAV_CONFIG)
    walkAcc(tr, [[0, 30], [0, 53]])
    const back = tr.update(pt(0, 40), 8)
    expect(back.nextTurn?.kind).toBe('right')
    expect(back.alongM).toBeGreaterThanOrEqual(60)
    expect(distanceM(back.target, pt(-20, 60))).toBeLessThan(1)
  })

  it('GPS 10 m past the corner while the projection is still before it: the turn counts as passed', () => {
    const tr = createTracker(ACUTE_LEFT, NAV_CONFIG)
    walkAcc(tr, [[0, 20], [0, 40]], 20)
    // 沿第二段走了 10 公尺，GPS 往東偏 3 公尺，最近的路線點落在第一段
    const [e, n] = acuteLeg2(10)
    const t = tr.update(pt(e + 3, n), 20)
    expect(distanceM(pt(e + 3, n), ACUTE_TURN_POINT)).toBeLessThan(10) // turnPassM = max(8, 10) = 10
    expect(t.nextTurn).toBeNull()
    expect(distanceM(t.target, pt(...acuteLeg2(20)))).toBeLessThan(1)
  })
})
