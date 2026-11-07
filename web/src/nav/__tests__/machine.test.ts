import { describe, expect, it } from 'vitest'
import { ReplaySensorSource } from '@/sensors/replay'
import type { PositionFix } from '@/sensors/source'
import { createAnnouncer } from '../announcer'
import type { Cue } from '../announcer'
import { NAV_CONFIG } from '../config'
import { bearingDeg } from '../geo'
import { createNavMachine } from '../machine'
import type { NavEffect, NavRoute } from '../machine'
import { ACUTE_LEFT, LEFT_THEN_RIGHT, LR_END, L_SHAPE, STRAIGHT, acuteLeg2, pt } from '../__fixtures__/routes'

/** 真北角度 → onHeading 吃的磁北角度 */
const mag = (trueDeg: number) => trueDeg - NAV_CONFIG.declinationDeg
/** 兩個角度差多少（0–180） */
const angleDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

function setup(route: NavRoute | null = STRAIGHT) {
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

  it('reroute failure: back_to_route, arrow points to the nearest route point, not the end', () => {
    const { m, pos, advance } = setup()
    m.start()
    m.onHeading(mag(0))
    m.onPosition(pos(0, 10))
    for (let i = 0; i < 3; i++) m.onPosition(pos(60, 12 + i))
    m.routeResult(null)
    advance(1)
    m.onHeading(mag(0))
    m.onPosition(pos(60, 14))
    const v = m.getView()
    expect(v.state).toBe('back_to_route')
    // 最近的路線點在正西方（0, 14）；終點 (0, 200) 在西北北
    const toRoute = bearingDeg(pt(60, 14), pt(0, 14))
    const toEnd = bearingDeg(pt(60, 14), pt(0, 200))
    expect(angleDiff(v.arrowDeg!, toRoute)).toBeLessThan(3)
    expect(angleDiff(v.arrowDeg!, toEnd)).toBeGreaterThan(30)
    // 還是原本那條路線
    expect(v.routeId).toBeNull()
    expect(v.distanceM).toBeCloseTo(60, 0)
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

describe('machine: arrow follows the route, not the destination', () => {
  it('L route (left then right), facing the first leg at the start: arrow ≈ 0°', () => {
    const { m, pos } = setup(LEFT_THEN_RIGHT)
    m.start()
    m.onHeading(mag(0))
    m.onPosition(pos(0, 0))
    const v = m.getView()
    expect(angleDiff(v.arrowDeg!, 0)).toBeLessThan(2)
    expect(v.direction).toBe('straight')
    // 若箭頭指終點，會偏左約 27°
    const toEnd = bearingDeg(pt(0, 0), LR_END)
    expect(angleDiff(v.arrowDeg!, toEnd)).toBeGreaterThan(20)
  })

  it('within turnPassM of the first corner the arrow and nextTurn switch to the second leg', () => {
    const { m, pos } = setup(LEFT_THEN_RIGHT)
    m.start()
    m.onHeading(mag(0))
    m.onPosition(pos(0, 30))
    expect(m.getView().nextTurn?.kind).toBe('left')
    m.onPosition(pos(0, 53))
    const v = m.getView()
    expect(v.nextTurn).toMatchObject({ kind: 'right', index: 12 })
    // 目標點在第二段 (-20, 60)，面向北時箭頭偏左
    expect(angleDiff(v.arrowDeg!, bearingDeg(pt(0, 53), pt(-20, 60)))).toBeLessThan(2)
    expect(v.direction).toBe('left')
  })

  it('GPS 10 m past the corner but projected before it: no "turn around"', () => {
    const { m, pos, advance } = setup(ACUTE_LEFT)
    m.start()
    m.onHeading(mag(0))
    m.onPosition(pos(0, 20, 20))
    m.onPosition(pos(0, 40, 20))
    // 已經轉過去，面向第二段（210°）；GPS 往東偏 3 公尺
    advance(1)
    m.onHeading(mag(210))
    expect(angleDiff(m.getView().headingDeg!, 210)).toBeLessThan(1)
    const [e, n] = acuteLeg2(10)
    m.onPosition(pos(e + 3, n, 20))
    const v = m.getView()
    expect(v.direction).not.toBe('turn_around')
    expect(angleDiff(v.arrowDeg!, 0)).toBeLessThan(25)
  })
})

describe('machine: debug fields', () => {
  it('exposes where the arrow points, the nearest route point and the route shape', () => {
    const { m, pos } = setup(LEFT_THEN_RIGHT)
    m.start()
    m.onHeading(mag(0))
    m.onPosition(pos(0, 10))
    const v = m.getView()
    expect(v.here).toEqual(pt(0, 10).map((x) => expect.closeTo(x, 9)))
    expect(bearingDeg(v.here!, v.targetPoint!)).toBeCloseTo(0, 0)
    expect(v.nearestPoint).not.toBeNull()
    expect(v.geometry).toBe(LEFT_THEN_RIGHT.geometry)
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

describe('replay an L route (left then right)', () => {
  it('announces each turn once, left then right, never says turn around, arrives once', () => {
    let t = 1_000_000
    const clock = () => t
    const m = createNavMachine({ route: LEFT_THEN_RIGHT, now: clock })
    const ann = createAnnouncer({ now: clock })
    const cues: Cue[] = []
    const states: string[] = []
    m.subscribe((v) => {
      cues.push(...ann.update(v))
      if (states.at(-1) !== v.state) states.push(v.state)
    })

    const replay = new ReplaySensorSource({ geometry: LEFT_THEN_RIGHT.geometry, speedMps: 1.4, now: clock })
    let prev: PositionFix | null = null
    m.start()
    replay.start({
      onHeading: () => {},
      onPosition: (p) => {
        // 朝向 = 這一步行進的方向（人面向自己走的方向）
        if (prev) m.onHeading(mag(bearingDeg([prev.lat, prev.lon], [p.lat, p.lon])))
        else m.onHeading(mag(0))
        prev = p
        m.onPosition(p)
      },
      onError: (c) => m.onError(c),
    })
    for (let i = 0; i < 400 && m.getView().state !== 'arrived'; i++) {
      t += 1000
      replay.tick(1)
    }
    replay.stop()

    expect(m.getView().state).toBe('arrived')
    expect(states.filter((s) => s === 'arrived')).toHaveLength(1)
    expect(states).not.toContain('rerouting')
    expect(cues.filter((c) => c.key === 'turn_ahead').map((c) => c.turn)).toEqual(['left', 'right'])
    expect(cues.filter((c) => c.key === 'turn_around')).toHaveLength(0)
    expect(cues.filter((c) => c.key === 'arrived')).toHaveLength(1)
  })
})

describe('machine: heading responsiveness', () => {
  // 部分 Android WebView 的羅盤事件只有 10 Hz 左右；平滑要依時間，不可依事件數
  it('follows a 90° turn within 300 ms even when events arrive at 10 Hz', () => {
    const { m, advance } = setup()
    m.start()
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
