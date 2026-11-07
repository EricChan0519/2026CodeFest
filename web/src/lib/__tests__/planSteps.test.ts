import { describe, expect, it } from 'vitest'
import type { LatLon, Station } from '../contract'
import type { Ride } from '@/nav/journey'
import { planSteps } from '../planSteps'

// 緯度 0.001 度約 111 公尺
const st = (lat: number): Station => ({ stationUid: String(lat), name: { zh: String(lat), en: String(lat) }, bearing: null, lat, lon: 121.5, routes: [] })
const ride = (mode: 'bus' | 'metro', lats: number[]): Ride => ({
  mode,
  board: st(lats[0]!),
  route: { routeName: { zh: mode, en: mode }, direction: 0, headsign: { zh: '', en: '' }, stopUid: 'x' },
  alight: st(lats[lats.length - 1]!),
  stops: lats.map(st),
})
const FROM: LatLon = [25.0, 121.5]

describe('planSteps', () => {
  it('走到上車站 → 搭車 → 轉乘走路 → 搭車 → 走到目的地', () => {
    const a = ride('bus', [25.002, 25.01, 25.02])
    const b = ride('metro', [25.021, 25.03, 25.04, 25.05])
    const steps = planSteps([a, b], FROM, [25.052, 121.5])
    expect(steps.map((s) => (s.kind === 'walk' ? `walk-${s.to}` : `ride-${s.n}`))).toEqual([
      'walk-board',
      'ride-2',
      'walk-board',
      'ride-3',
      'walk-dest',
    ])
    expect(steps[0]).toMatchObject({ kind: 'walk', ride: a })
    // 約 222 公尺 × 繞路 1.25
    expect(steps[0]!.kind === 'walk' && steps[0]!.m).toBeGreaterThan(250)
  })
  it('站內轉乘、下車就到不列走路', () => {
    const a = ride('metro', [25.002, 25.02])
    const b = ride('metro', [25.02, 25.05])
    const steps = planSteps([a, b], [25.002, 121.5], [25.05, 121.5])
    expect(steps.map((s) => s.kind)).toEqual(['ride', 'ride'])
  })
})
