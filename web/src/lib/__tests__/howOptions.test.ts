import { describe, expect, it } from 'vitest'
import type { LatLon } from '../contract'
import type { Station } from '../contract'
import type { Ride } from '@/nav/journey'
import type { TransitPlan } from '../transitPlan'
import { bestCandidates, listOptions, metroCandidates, pickByMode } from '../howOptions'

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

describe('listOptions', () => {
  it('附近沒有站：none', () => {
    // 上車站離出發點約 3.3 公里
    expect(listOptions([plan([ride('bus', 25.03, 25.05)], 900)], FROM, TO, 'fast').status).toBe('none')
    expect(listOptions([], FROM, TO, 'fast').status).toBe('none')
  })
  it('附近有站但末班車已過：ended，方案放在搭不到那組', () => {
    const p = plan([ride('bus', 25.001, 25.049)], 900, 300, 'ended')
    expect(listOptions([p], FROM, TO, 'fast')).toEqual({ status: 'ended', ok: [], unavailable: [p] })
  })
  it('有一班搭得到就是 ok，搭不到的另外列', () => {
    const gone = plan([ride('bus', 25.001, 25.049)], 900, 300, 'ended')
    const okPlan = plan([ride('bus', 25.001, 25.049)], 1500)
    expect(listOptions([gone, okPlan], FROM, TO, 'fast')).toEqual({ status: 'ok', ok: [okPlan], unavailable: [gone] })
  })
  it('首班車還沒開：not_started', () => {
    expect(listOptions([plan([ride('metro', 25.001, 25.049)], 900, 300, 'not_started')], FROM, TO, 'fast').status).toBe('not_started')
  })
  it('依路線模式把最合適的排第一，其餘依時間', () => {
    const quick = plan([ride('bus', 25.001, 25.02), ride('bus', 25.02, 25.049)], 1000, 600)
    const easy = plan([ride('bus', 25.001, 25.049)], 1150, 120)
    const slow = plan([ride('bus', 25.001, 25.049)], 1100, 500)
    expect(listOptions([easy, slow, quick], FROM, TO, 'fast').ok).toEqual([quick, slow, easy])
    expect(listOptions([easy, slow, quick], FROM, TO, 'gentle').ok).toEqual([easy, quick, slow])
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

describe('candidates', () => {
  it('捷運只用只搭捷運的方案，最佳用混搭', () => {
    const m = plan([ride('metro', 25.001, 25.049)], 900)
    const mix = plan([ride('bus', 25.001, 25.01), ride('metro', 25.01, 25.049)], 1000)
    const b = plan([ride('bus', 25.001, 25.049)], 900)
    const plans = { mixed: [mix, b, m], bus: [b], metro: [m] }
    expect(metroCandidates(plans)).toEqual([m])
    expect(bestCandidates(plans)).toEqual([mix, b, m])
  })
})
