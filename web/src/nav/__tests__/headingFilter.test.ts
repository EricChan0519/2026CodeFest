import { describe, expect, it } from 'vitest'
import { NAV_CONFIG } from '../config'
import { angleDiff } from '../geo'
import { createHeadingFilter } from '../headingFilter'

const dist = (a: number, b: number) => Math.abs(angleDiff(a, b))

describe('headingFilter', () => {
  it('adopts the first sample as is', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    expect(f.update(123, 0)).toBeCloseTo(123)
  })

  it('a single wild sample is ignored (spike)', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    let t = 0
    f.update(10, t)
    for (let i = 0; i < 10; i++) f.update(10, (t += 16))
    const out = f.update(190, (t += 16)) // 偏 180°
    expect(dist(out, 10)).toBeLessThan(1)
    f.update(10, (t += 16)) // 回到原本
    expect(dist(f.value!, 10)).toBeLessThan(1)
  })

  it('two consistent far samples count as a real turn', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    let t = 0
    f.update(0, t)
    f.update(90, (t += 100))
    const out = f.update(92, (t += 100))
    expect(dist(out, 92)).toBeLessThan(2)
  })

  it('suppresses jitter when stable, much more than a fast tracker would', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    let t = 0
    f.update(100, t)
    const outs: number[] = []
    for (let i = 0; i < 120; i++) {
      t += 16
      outs.push(f.update(100 + (i % 2 === 0 ? 4 : -4), t)) // ±4° 抖動
    }
    const swing = Math.max(...outs.slice(30)) - Math.min(...outs.slice(30))
    expect(swing).toBeLessThan(1.6)
  })

  it('still follows a steady turn closely', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    let t = 0
    f.update(0, t)
    let truth = 0
    for (let i = 0; i < 60; i++) {
      t += 16
      truth += 1.2 // 約 75°/s
      f.update(truth, t)
    }
    expect(dist(f.value!, truth)).toBeLessThan(15)
  })

  it('snaps after a long gap instead of sliding from the stale value', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    f.update(0, 0)
    f.update(0, 16)
    const out = f.update(40, 16 + NAV_CONFIG.headingGapResetMs + 1)
    expect(dist(out, 40)).toBeLessThan(0.5)
  })

  it('wraps around north without averaging to 180', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    let t = 0
    f.update(359, t)
    for (let i = 0; i < 20; i++) f.update(i % 2 ? 1 : 359, (t += 16))
    expect(dist(f.value!, 0)).toBeLessThan(3)
  })

  it('reset forgets the previous value', () => {
    const f = createHeadingFilter(NAV_CONFIG)
    f.update(0, 0)
    f.reset()
    expect(f.value).toBeNull()
    expect(f.update(200, 10)).toBeCloseTo(200)
  })
})
