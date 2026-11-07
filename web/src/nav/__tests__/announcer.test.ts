import { describe, expect, it } from 'vitest'
import { createAnnouncer } from '../announcer'
import type { NavView } from '../machine'

const base: NavView = {
  state: 'navigating',
  failReason: null,
  headingLost: false,
  hasPosition: true,
  accuracyM: 8,
  distanceM: 100,
  arrowDeg: 0,
  cssRotation: 0,
  direction: 'straight',
  hollowArrow: false,
  nextTurn: null,
  progress: 0.2,
  headingDeg: 0,
  headingCheck: 'unknown',
  headingOffsetDeg: null,
  routeId: null,
}
const view = (o: Partial<NavView>): NavView => ({ ...base, ...o })

function setup() {
  let t = 1_000_000
  const a = createAnnouncer({ now: () => t })
  return { a, advance: (s: number) => (t += s * 1000) }
}

describe('announcer', () => {
  it('says the start line once', () => {
    const { a } = setup()
    expect(a.update(view({})).map((c) => c.key)).toEqual(['start'])
    expect(a.update(view({}))).toEqual([])
  })

  it('announces a turn once with turn haptic, interrupting speech', () => {
    const { a } = setup()
    a.update(view({}))
    const near = view({ nextTurn: { kind: 'left', distanceM: 25, index: 7 } })
    const cues = a.update(near)
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({ key: 'turn_ahead', turn: 'left', haptic: 'turn', interrupt: true })
    expect(a.update(near)).toEqual([])
  })

  it('does not announce a turn that is still far', () => {
    const { a } = setup()
    a.update(view({}))
    expect(a.update(view({ nextTurn: { kind: 'left', distanceM: 80, index: 7 } }))).toEqual([])
  })

  it('same sentence twice within 3 s is only said once', () => {
    const { a, advance } = setup()
    a.update(view({}))
    expect(a.update(view({ state: 'rerouting' })).map((c) => c.key)).toEqual(['off_route'])
    a.update(view({ state: 'navigating' }))
    advance(3)
    expect(a.update(view({ state: 'rerouting' }))).toEqual([])
    a.update(view({ state: 'navigating' }))
    advance(10)
    expect(a.update(view({ state: 'rerouting' })).map((c) => c.key)).toEqual(['off_route'])
  })

  it('off route uses the warn haptic', () => {
    const { a } = setup()
    a.update(view({}))
    expect(a.update(view({ state: 'rerouting' }))[0]).toMatchObject({ haptic: 'warn', interrupt: true })
  })

  it('turn around is announced when it starts, not on every update', () => {
    const { a } = setup()
    a.update(view({}))
    expect(a.update(view({ direction: 'turn_around' })).map((c) => c.key)).toEqual(['turn_around'])
    expect(a.update(view({ direction: 'turn_around' }))).toEqual([])
  })

  it('arrival is announced once with the arrive haptic, and stays silent (the /arrived screen speaks)', () => {
    const { a } = setup()
    a.update(view({}))
    const cues = a.update(view({ state: 'arrived' }))
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({ key: 'arrived', haptic: 'arrive', speak: false })
    expect(a.update(view({ state: 'arrived' }))).toEqual([])
  })

  it('every cue except arrival is spoken', () => {
    const { a } = setup()
    const all = [
      ...a.update(view({})),
      ...a.update(view({ nextTurn: { kind: 'left', distanceM: 25, index: 1 } })),
      ...a.update(view({ direction: 'turn_around' })),
      ...a.update(view({ state: 'rerouting' })),
      ...a.update(view({ state: 'weak_signal' })),
    ]
    expect(all.length).toBeGreaterThanOrEqual(4)
    expect(all.every((c) => c.speak)).toBe(true)
  })

  it('weak signal warns when entering', () => {
    const { a } = setup()
    a.update(view({}))
    expect(a.update(view({ state: 'weak_signal' })).map((c) => c.key)).toEqual(['weak_signal'])
  })
})
