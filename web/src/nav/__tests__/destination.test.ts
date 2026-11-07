import { describe, expect, it } from 'vitest'
import { DEFAULT_DESTINATION, createDestinationLock, nearestPoint } from '../destination'
import type { Destination } from '../destination'
import { pt } from '../__fixtures__/routes'

// 馬路兩側各一個站位，相距 40 公尺
const STOP: Destination = { name: '測試站', points: [pt(0, 200), pt(40, 200)] }

describe('destination', () => {
  it('nearestPoint picks the closer stop position', () => {
    expect(nearestPoint(STOP, pt(-10, 0))).toEqual(STOP.points[0])
    expect(nearestPoint(STOP, pt(50, 0))).toEqual(STOP.points[1])
  })

  it('the lock picks the nearest stop once and keeps it for every reroute', () => {
    const lock = createDestinationLock(STOP)
    expect(lock.pick(pt(-10, 0))).toEqual(STOP.points[0])
    // 走偏到另一側：重算時目的地不可以跳到另一個站位
    expect(lock.pick(pt(60, 150))).toEqual(STOP.points[0])
    expect(lock.point).toEqual(STOP.points[0])
  })

  it('reset lets a new trip pick again', () => {
    const lock = createDestinationLock(STOP)
    lock.pick(pt(-10, 0))
    lock.reset()
    expect(lock.point).toBeNull()
    expect(lock.pick(pt(60, 150))).toEqual(STOP.points[1])
  })

  it('the default destination has two stop positions', () => {
    expect(DEFAULT_DESTINATION.points).toHaveLength(2)
  })
})
