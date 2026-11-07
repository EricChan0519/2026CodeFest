import { describe, expect, it } from 'vitest'
import type { LatLon } from '../contract'
import type { Station } from '../contract'
import type { Ride } from '@/nav/journey'
import type { TransitPlan } from '../transitPlan'
import { metroCandidates, pickByMode, pickOption } from '../howOptions'

const FROM: LatLon = [25.0, 121.5]
const TO: LatLon = [25.05, 121.5]
// 緯度 0.001 度約 111 公尺
const st = (lat: number): Station => ({ stationUid: String(lat), name: { zh: String(lat), en: String(lat) }, bearing: null, lat, lon: 121.5, routes: [] })
const ride = (mode: 'bus' | 'metro', boardLat: number, alightLat: number): Ride => ({
  mode,
  board: st(boardLat),
  route: { routeName: { zh: mode, en: mode }, direction: 0, headsign: { zh: '', en: '' }, stopUid: 'x' },
  alight: st(alightLat),
  stops: [st(boardLat), st(alightLat)],
})
const plan = (rides: Ride[], durationS: number, walkS = 300, service: TransitPlan['service'] = 'ok'): TransitPlan => ({
  rides,
  durationS,
  walkS,
  waitS: 0,
  rideS: durationS - walkS,
  walkM: walkS,
  service,
})

describe('pickOption', () => {
  it('附近沒有站：none', () => {
    // 上車站離出發點約 3.3 公里
    expect(pickOption([plan([ride('bus', 25.03, 25.05)], 900)], FROM, TO, 'fast').status).toBe('none')
    expect(pickOption([], FROM, TO, 'fast').status).toBe('none')
  })
  it('附近有站但末班車已過：ended，不給方案', () => {
    const o = pickOption([plan([ride('bus', 25.001, 25.049)], 900, 300, 'ended')], FROM, TO, 'fast')
    expect(o).toEqual({ status: 'ended', plan: null })
  })
  it('有一班搭得到就能選，搭不到的不選', () => {
    const okPlan = plan([ride('bus', 25.001, 25.049)], 1500)
    const o = pickOption([plan([ride('bus', 25.001, 25.049)], 900, 300, 'ended'), okPlan], FROM, TO, 'fast')
    expect(o).toEqual({ status: 'ok', plan: okPlan })
  })
  it('首班車還沒開：not_started', () => {
    expect(pickOption([plan([ride('metro', 25.001, 25.049)], 900, 300, 'not_started')], FROM, TO, 'fast').status).toBe('not_started')
  })
})

describe('pickByMode', () => {
  const fast = { durationS: 1000, walkS: 600, rides: 2 }
  const easy = { durationS: 1150, walkS: 120, rides: 1 }
  const slow = { durationS: 1300, walkS: 0, rides: 1 }
  it('快速：最快的', () => {
    expect(pickByMode([easy, fast], 'fast')).toBe(1)
  })
  it('安全、平緩：1.2 倍時間內少走路、少轉車的', () => {
    expect(pickByMode([fast, easy], 'safe')).toBe(1)
    expect(pickByMode([fast, easy], 'gentle')).toBe(1)
  })
  it('超過最快 1.2 倍的不選', () => {
    expect(pickByMode([fast, slow], 'gentle')).toBe(0)
  })
  it('空的回傳 -1', () => {
    expect(pickByMode([], 'fast')).toBe(-1)
  })
})

describe('metroCandidates', () => {
  it('只搭捷運＋有搭捷運的混搭，不含只搭公車和走路', () => {
    const m = plan([ride('metro', 25.001, 25.049)], 900)
    const mix = plan([ride('bus', 25.001, 25.01), ride('metro', 25.01, 25.049)], 1000)
    const b = plan([ride('bus', 25.001, 25.049)], 900)
    const walk = plan([], 3000)
    expect(metroCandidates({ mixed: [walk, mix, b], bus: [b], metro: [m] })).toEqual([m, mix])
  })
})
