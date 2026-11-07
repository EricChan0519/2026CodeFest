import { describe, expect, it } from 'vitest'
import { NAV_CONFIG, arriveRadiusM, offRouteM, turnPassM } from '../config'

describe('NAV_CONFIG', () => {
  it('matches the starting values in 04-nav-logic', () => {
    expect(NAV_CONFIG.lookaheadM).toBe(20)
    expect(NAV_CONFIG.offRouteHits).toBe(3)
    expect(NAV_CONFIG.arriveHits).toBe(2)
    expect(NAV_CONFIG.declinationDeg).toBe(-4.7)
    expect(NAV_CONFIG.rerouteCooldownS).toBe(20)
    expect(NAV_CONFIG.weakAccuracyM).toBe(50)
    expect(NAV_CONFIG.announceBeforeTurnM).toBe(30)
    expect(NAV_CONFIG.repeatMuteS).toBe(10)
  })

  it('arrive radius is max(15, accuracy)', () => {
    expect(arriveRadiusM(5)).toBe(15)
    expect(arriveRadiusM(30)).toBe(30)
  })

  it('off-route distance is max(30, 1.5 x accuracy)', () => {
    expect(offRouteM(5)).toBe(30)
    expect(offRouteM(30)).toBe(45)
  })

  it('turn pass distance is max(8, 0.5 x accuracy)', () => {
    expect(turnPassM(5)).toBe(8)
    expect(turnPassM(30)).toBe(15)
  })
})
