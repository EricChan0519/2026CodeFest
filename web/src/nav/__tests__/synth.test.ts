import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceM } from '../geo'
import * as synth from '../synth'
import { twoLegRoute } from '../synth'
import { ORIGIN } from '../__fixtures__/routes'

describe('synth routes', () => {
  it('two legs go the right way and the right distance', () => {
    const r = twoLegRoute(ORIGIN, 90, { leg1M: 80, leg2M: 60, turn: 'right' })
    const g = r.geometry
    expect(distanceM(g[0]!, g[8]!)).toBeCloseTo(80, 0)
    expect(bearingDeg(g[0]!, g[8]!)).toBeCloseTo(90, 0) // 先往東
    expect(bearingDeg(g[8]!, g.at(-1)!)).toBeCloseTo(180, 0) // 右轉往南
    expect(r.maneuvers[1]).toMatchObject({ kind: 'right', atIndex: 8 })
    expect(r.maneuvers.at(-1)?.atIndex).toBe(g.length - 1)
  })

  it('has no straight-line route to the end (reroute must never draw one)', () => {
    expect(Object.keys(synth)).not.toContain('straightRoute')
  })
})
