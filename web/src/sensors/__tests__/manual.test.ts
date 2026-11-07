import { describe, expect, it } from 'vitest'
import { distanceM, toLocalXY } from '@/nav/geo'
import type { PositionFix } from '../source'
import { ManualGpsSource } from '../manual'
import { ORIGIN } from '@/nav/__fixtures__/routes'

function setup() {
  const fixes: PositionFix[] = []
  const src = new ManualGpsSource({ start: ORIGIN, accuracyM: 5, now: () => 1000 })
  src.start({ onHeading: () => {}, onPosition: (p) => fixes.push(p), onError: () => {} })
  return { src, fixes }
}

describe('ManualGpsSource（方向鍵模擬 GPS）', () => {
  it('emits the start position right away', () => {
    const { src, fixes } = setup()
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toMatchObject({ lat: ORIGIN[0], lon: ORIGIN[1], accuracyM: 5 })
    src.stop()
  })

  it('forward moves toward the given heading', () => {
    const { src, fixes } = setup()
    src.step(90, 10, 0) // 面向東，往前 10 m
    const [e, n] = toLocalXY(ORIGIN, [fixes.at(-1)!.lat, fixes.at(-1)!.lon])
    expect(e).toBeCloseTo(10, 1)
    expect(n).toBeCloseTo(0, 1)
    src.stop()
  })

  it('right side-steps perpendicular to the heading', () => {
    const { src, fixes } = setup()
    src.step(0, 0, 5) // 面向北，往右 5 m = 往東
    const [e, n] = toLocalXY(ORIGIN, [fixes.at(-1)!.lat, fixes.at(-1)!.lon])
    expect(e).toBeCloseTo(5, 1)
    expect(n).toBeCloseTo(0, 1)
    src.stop()
  })

  it('moveTo teleports and keeps moving from there', () => {
    const { src, fixes } = setup()
    const far: [number, number] = [ORIGIN[0] + 0.001, ORIGIN[1]]
    src.moveTo(far)
    src.step(180, 10, 0)
    expect(distanceM([fixes.at(-1)!.lat, fixes.at(-1)!.lon], far)).toBeCloseTo(10, 1)
    expect(src.position).toEqual([fixes.at(-1)!.lat, fixes.at(-1)!.lon])
    src.stop()
  })

  it('does not emit after stop', () => {
    const { src, fixes } = setup()
    src.stop()
    src.step(0, 10, 0)
    expect(fixes).toHaveLength(1)
  })
})
