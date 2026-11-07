import { describe, expect, it } from 'vitest'
import { ReplaySensorSource } from '@/sensors/replay'
import type { PositionFix } from '@/sensors/source'
import { createAnnouncer } from '../announcer'
import type { Cue } from '../announcer'
import { NAV_CONFIG } from '../config'
import { createNavMachine } from '../machine'
import type { NavEffect } from '../machine'
import { L_SHAPE, STRAIGHT, pt } from '../__fixtures__/routes'

function setup(route: typeof STRAIGHT | null = STRAIGHT) {
  let t = 1_000_000
  const clock = () => t
  const m = createNavMachine({ route, now: clock })
  const effects: NavEffect[] = []
  m.onEffect((e) => effects.push(e))
  const pos = (e: number, n: number, accuracyM = 8): PositionFix => {
    const [lat, lon] = pt(e, n)
    return { lat, lon, accuracyM, ts: t }
  }
  const advance = (s: number) => {
    t += s * 1000
  }
  return { m, effects, pos, advance }
}

describe('machine: startup', () => {
  it('locating -> routing -> navigating without a route', () => {
    const { m, effects, pos } = setup(null)
    m.start()
    expect(m.getView().state).toBe('locating')
    m.onPosition(pos(0, 0))
    expect(m.getView().state).toBe('routing')
    expect(effects).toHaveLength(1)
    expect(effects[0]!.candidate).toBeNull()
    m.routeResult(STRAIGHT)
    expect(m.getView().state).toBe('navigating')
  })

  it('goes straight to navigating when the route is already known (P5)', () => {
    const { m } = setup(STRAIGHT)
    m.start()
    expect(m.getView().state).toBe('navigating')
  })

  it('fails when location is denied or no route can be found', () => {
    const a = setup(null)
    a.m.start()
    a.m.onError('location_denied')
    expect(a.m.getView().state).toBe('failed')
    expect(a.m.getView().failReason).toBe('location_denied')

    const b = setup(null)
    b.m.start()
    b.m.onPosition(b.pos(0, 0))
    b.m.routeResult(null)
    expect(b.m.getView().state).toBe('failed')
    expect(b.m.getView().failReason).toBe('route_failed')
  })
})

describe('machine: signal quality', () => {
  it('accuracy 80 m -> weak_signal, recovers when accuracy is good again', () => {
    const { m, pos } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    m.onPosition(pos(0, 12, 80))
    expect(m.getView().state).toBe('weak_signal')
    expect(m.getView().hollowArrow).toBe(true)
    m.onPosition(pos(0, 14, 8))
    expect(m.getView().state).toBe('navigating')
  })

  it('no position for staleGpsS -> weak_signal', () => {
    const { m, pos, advance } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    advance(NAV_CONFIG.staleGpsS + 1)
    m.tick()
    expect(m.getView().state).toBe('weak_signal')
  })

  it('no heading event for headingLostS -> headingLost, distance keeps working', () => {
    const { m, pos, advance } = setup()
    m.start()
    m.onHeading(0)
    m.onPosition(pos(0, 50))
    expect(m.getView().arrowDeg).not.toBeNull()
    advance(NAV_CONFIG.headingLostS + 0.5)
    m.tick()
    const v = m.getView()
    expect(v.headingLost).toBe(true)
    expect(v.arrowDeg).toBeNull()
    expect(v.distanceM).toBeCloseTo(150, 0)
  })

  it('a phone without a compass sets headingLost right away', () => {
    const { m } = setup()
    m.start()
    m.onError('no_heading_sensor')
    expect(m.getView().headingLost).toBe(true)
  })
})

describe('machine: arrow', () => {
  it('heading north on a north route points straight ahead (declination applied)', () => {
    const { m, pos } = setup()
    m.start()
    // 磁北朝向 4.7° + 磁偏角 -4.7° = 真北 0°
    m.onHeading(4.7)
    m.onPosition(pos(0, 50))
    const v = m.getView()
    expect(v.arrowDeg === null ? 99 : Math.min(v.arrowDeg, 360 - v.arrowDeg)).toBeLessThan(1)
    expect(v.direction).toBe('straight')
  })

  it('facing east on a north route means turn left', () => {
    const { m, pos } = setup()
    m.start()
    m.onHeading(90 + 4.7)
    m.onPosition(pos(0, 50))
    expect(m.getView().direction).toBe('left')
  })
})

describe('machine: off route', () => {
  it('a single off-route fix does not reroute', () => {
    const { m, effects, pos } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    m.onPosition(pos(60, 12))
    m.onPosition(pos(0, 14))
    expect(effects).toHaveLength(0)
    expect(m.getView().state).toBe('navigating')
  })

  it('three consecutive off-route fixes reroute exactly once (cooldown)', () => {
    const { m, effects, pos, advance } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    for (let i = 0; i < 3; i++) m.onPosition(pos(60, 12 + i))
    expect(m.getView().state).toBe('rerouting')
    expect(effects).toHaveLength(1)
    expect(effects[0]!.candidate).toBeNull() // 目前的路線沒有 id

    // 重算失敗 -> back_to_route；冷卻時間內再偏離不會再要求
    m.routeResult(null)
    expect(m.getView().state).toBe('back_to_route')
    advance(5)
    for (let i = 0; i < 5; i++) m.onPosition(pos(60, 20 + i))
    expect(effects).toHaveLength(1)
  })

  it('reroute passes the current candidate id', () => {
    const { m, effects, pos } = setup()
    m.start()
    m.routeResult(null) // 無效，只是確認不在 routing 時不會崩
    const withId = createNavMachine({ route: { ...STRAIGHT, id: 'fastest' } })
    withId.onEffect((e) => effects.push(e))
    withId.start()
    withId.onPosition(pos(0, 10))
    for (let i = 0; i < 3; i++) withId.onPosition(pos(60, 12 + i))
    expect(effects.at(-1)?.candidate).toBe('fastest')
  })

  it('back_to_route returns to navigating once on the route', () => {
    const { m, pos } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    for (let i = 0; i < 3; i++) m.onPosition(pos(60, 12 + i))
    m.routeResult(null)
    expect(m.getView().state).toBe('back_to_route')
    expect(m.getView().distanceM).toBeGreaterThan(40)
    m.onPosition(pos(1, 20))
    expect(m.getView().state).toBe('navigating')
  })

  it('a successful reroute goes back to navigating on the new route', () => {
    const { m, pos } = setup()
    m.start()
    m.onPosition(pos(0, 10))
    for (let i = 0; i < 3; i++) m.onPosition(pos(60, 12 + i))
    m.routeResult(L_SHAPE)
    expect(m.getView().state).toBe('navigating')
  })
})

describe('machine: arrival', () => {
  it('needs arriveHits consecutive fixes inside the radius', () => {
    const { m, pos } = setup()
    m.start()
    m.onPosition(pos(0, 120))
    m.onPosition(pos(0, 190)) // 離終點 10 m，第 1 次
    expect(m.getView().state).toBe('navigating')
    m.onPosition(pos(0, 192)) // 第 2 次
    expect(m.getView().state).toBe('arrived')
  })

  it('a bad-accuracy fix breaks the streak', () => {
    const { m, pos } = setup()
    m.start()
    m.onPosition(pos(0, 190))
    m.onPosition(pos(0, 192, 80))
    m.onPosition(pos(0, 194))
    expect(m.getView().state).toBe('navigating')
  })
})

describe('replay + machine + announcer', () => {
  it('replaying a whole route ends in arrived, arrives only once, announces the turn once', () => {
    let t = 1_000_000
    const clock = () => t
    const m = createNavMachine({ route: L_SHAPE, now: clock })
    const ann = createAnnouncer({ now: clock })
    const cues: Cue[] = []
    m.subscribe((v) => cues.push(...ann.update(v)))
    const arrivedStates: string[] = []
    m.subscribe((v) => {
      if (arrivedStates.at(-1) !== v.state) arrivedStates.push(v.state)
    })

    const replay = new ReplaySensorSource({ geometry: L_SHAPE.geometry, speedMps: 1.4, now: clock })
    m.start()
    replay.start({
      onHeading: (d) => m.onHeading(d),
      onPosition: (p) => m.onPosition(p),
      onError: (c) => m.onError(c),
    })
    // start() 內建的 setInterval 不在測試裡跑，改手動推進
    for (let i = 0; i < 400 && m.getView().state !== 'arrived'; i++) {
      t += 1000
      m.onHeading(0)
      replay.tick(1)
    }
    replay.stop()

    expect(m.getView().state).toBe('arrived')
    expect(arrivedStates.filter((s) => s === 'arrived')).toHaveLength(1)
    expect(cues.filter((c) => c.key === 'arrived')).toHaveLength(1)
    expect(cues.filter((c) => c.key === 'turn_ahead')).toHaveLength(1)
    expect(cues.find((c) => c.key === 'turn_ahead')?.turn).toBe('right')
    expect(cues.filter((c) => c.key === 'start')).toHaveLength(1)
  })
})

describe('machine: heading noise and resync', () => {
  const mag = (trueDeg: number) => trueDeg - NAV_CONFIG.declinationDeg

  it('one wild heading sample does not make the arrow jump', () => {
    const { m, pos, advance } = setup()
    m.start()
    m.onPosition(pos(0, 50))
    for (let i = 0; i < 20; i++) {
      advance(1 / 30)
      m.onHeading(mag(0))
    }
    const before = m.getView().cssRotation
    advance(1 / 30)
    m.onHeading(mag(170))
    expect(Math.abs(m.getView().cssRotation - before)).toBeLessThan(2)
  })

  it('silent compass asks for a resync once, then respects the cooldown', () => {
    const { m, advance } = setup()
    const reasons: string[] = []
    m.onResync((r) => reasons.push(r))
    m.start()
    m.onHeading(0)
    advance(NAV_CONFIG.headingStaleS + 0.5)
    m.tick()
    expect(reasons).toEqual(['heading_silent'])
    advance(1)
    m.tick()
    expect(reasons).toHaveLength(1)
    advance(NAV_CONFIG.resyncCooldownS)
    m.tick()
    expect(reasons).toHaveLength(2)
  })

  it('a frozen compass value (events keep coming, value never changes) asks for a resync', () => {
    const { m, advance } = setup()
    const reasons: string[] = []
    m.onResync((r) => reasons.push(r))
    m.start()
    for (let i = 0; i < NAV_CONFIG.headingFrozenS + 2; i++) {
      advance(1)
      m.onHeading(123.456)
      m.tick()
    }
    expect(reasons).toContain('heading_frozen')
  })

  it('a live compass never asks for a resync', () => {
    const { m, advance } = setup()
    const reasons: string[] = []
    m.onResync((r) => reasons.push(r))
    m.start()
    for (let i = 0; i < 30; i++) {
      advance(1)
      m.onHeading(100 + (i % 2) * 0.3)
      m.tick()
    }
    expect(reasons).toHaveLength(0)
  })

  it('resync() makes the next heading take effect immediately', () => {
    const { m, advance } = setup()
    m.start()
    m.onHeading(mag(0))
    advance(0.1)
    m.onHeading(mag(0))
    m.resync()
    advance(0.1)
    m.onHeading(mag(200))
    expect(m.getView().headingDeg!).toBeGreaterThan(199)
    expect(m.getView().headingDeg!).toBeLessThan(201)
  })

  it('walking while the compass points sideways flags the heading and resyncs once', () => {
    const { m, pos, advance } = setup()
    const reasons: string[] = []
    m.onResync((r) => reasons.push(r))
    m.start()
    for (let i = 0; i < 60; i++) {
      advance(1)
      m.onHeading(mag(90)) // 羅盤說朝東，實際往北走
      m.onPosition(pos(0, 20 + i * 1.4))
      m.tick()
    }
    expect(m.getView().headingCheck).toBe('suspect')
    expect(reasons.filter((r) => r === 'course_mismatch')).toHaveLength(1)
  })

  it('courseCheck: false disables the walking-direction check', () => {
    let t = 1_000_000
    const m = createNavMachine({ route: STRAIGHT, now: () => t, courseCheck: false })
    m.start()
    for (let i = 0; i < 60; i++) {
      t += 1000
      m.onHeading(mag(90))
      const [lat, lon] = pt(0, 20 + i * 1.4)
      m.onPosition({ lat, lon, accuracyM: 8, ts: t })
    }
    expect(m.getView().headingCheck).toBe('unknown')
  })
})

describe('machine: heading responsiveness', () => {
  // 部分 Android WebView 的羅盤事件只有 10 Hz 左右；平滑要依時間，不可依事件數
  it('follows a 90° turn within 300 ms even when events arrive at 10 Hz', () => {
    const { m, advance } = setup()
    m.start()
    const mag = (trueDeg: number) => trueDeg - NAV_CONFIG.declinationDeg
    m.onHeading(mag(0))
    for (let i = 0; i < 3; i++) {
      advance(0.1)
      m.onHeading(mag(90))
    }
    expect(m.getView().headingDeg!).toBeGreaterThan(80)
  })

  it('still smooths jitter at 60 Hz (one noisy sample moves less than a third)', () => {
    const { m, advance } = setup()
    m.start()
    const mag = (trueDeg: number) => trueDeg - NAV_CONFIG.declinationDeg
    m.onHeading(mag(0))
    for (let i = 0; i < 30; i++) {
      advance(1 / 60)
      m.onHeading(mag(0))
    }
    advance(1 / 60)
    m.onHeading(mag(30))
    const h = m.getView().headingDeg!
    expect(Math.min(h, 360 - h)).toBeLessThan(10)
  })
})
