import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/contract'
import { SHIDONG_EDGES, SHIDONG_NORTH_SIDE, SHIDONG_ROUTE, SHIDONG_SOUTH_CURB } from '@/lib/__fixtures__/shidongCrossing'
import { applyCrossings, parseValhalla } from '@/lib/walkRoute'
import { createAnnouncer } from '../announcer'
import { angleDiff, bearingDeg, lerpLatLon } from '../geo'
import { createNavMachine } from '../machine'

/**
 * 2026-11-07 回報：士東路 286 巷往北走，還沒過士東路就顯示「右轉」，應該先過馬路再右轉。
 * 用實際的路線走一遍：過馬路前只能說「過馬路（過完再右轉）」，箭頭指向對面，不能指向東邊。
 */
function setup(accuracyM = 8) {
  const route = parseValhalla(SHIDONG_ROUTE, 'x')
  route.maneuvers = applyCrossings(route.maneuvers, route.geometry, SHIDONG_EDGES)
  const m = createNavMachine({ route, courseCheck: false })
  const a = createAnnouncer({ now: () => 0 })
  m.start()
  m.onHeading(0)
  let ts = 1_000
  const cues: string[] = []
  const at = (p: LatLon) => {
    ts += 1000
    m.onPosition({ lat: p[0], lon: p[1], accuracyM, ts })
    const v = m.getView()
    for (const c of a.update(v)) if (c.key === 'turn_ahead') cues.push(c.turn === 'cross' ? `cross+${c.then}` : c.turn!)
    return v
  }
  return { route, at, cues }
}

describe('cross 士東路 before turning right (286巷 → 299巷)', () => {
  it('walking up to the curb: next step is "cross, then right", never a plain right', () => {
    const { route, at, cues } = setup()
    const g = route.geometry
    for (const p of [g[0]!, lerpLatLon(g[0]!, g[1]!, 0.5), g[1]!, g[2]!, g[3]!, SHIDONG_SOUTH_CURB]) {
      const v = at(p)
      expect(v.nextTurn).toMatchObject({ kind: 'cross', then: 'right' })
    }
    expect(cues).toEqual(['cross+right'])
  })

  it('at the south curb the arrow points across the road (north), not east along it', () => {
    const { route, at } = setup()
    const g = route.geometry
    for (const p of [g[0]!, g[1]!, g[2]!, g[3]!]) at(p)
    const v = at(SHIDONG_SOUTH_CURB)
    const toTarget = bearingDeg(SHIDONG_SOUTH_CURB, v.targetPoint!)
    expect(Math.abs(angleDiff(toTarget, 0))).toBeLessThan(30)
    expect(Math.abs(angleDiff(toTarget, 72))).toBeGreaterThan(45) // 72° 是沿士東路往東
  })

  it('mid-road with poor GPS still is not "across" yet', () => {
    const { route, at } = setup(25)
    const g = route.geometry
    for (const p of [g[0]!, g[1]!, g[2]!, g[3]!, g[4]!]) at(p)
    expect(at(g[5]!).nextTurn).toMatchObject({ kind: 'cross' }) // 士東路中間
  })

  it('once across, the next step is the left turn into 299巷', () => {
    const { route, at, cues } = setup()
    const g = route.geometry
    for (const p of [g[0]!, g[1]!, g[2]!, g[3]!, g[4]!, g[5]!]) at(p)
    const v = at(SHIDONG_NORTH_SIDE)
    expect(v.nextTurn).toMatchObject({ kind: 'left' })
    at(g[7]!)
    expect(cues).toEqual(['cross+right', 'left'])
  })

  it('without the fix the same walk would have said "right" before crossing', () => {
    const route = parseValhalla(SHIDONG_ROUTE, 'x')
    const m = createNavMachine({ route, courseCheck: false })
    m.start()
    m.onHeading(0)
    m.onPosition({ lat: route.geometry[1]![0], lon: route.geometry[1]![1], accuracyM: 8, ts: 2000 })
    expect(m.getView().nextTurn).toMatchObject({ kind: 'right', index: 2 })
  })
})
