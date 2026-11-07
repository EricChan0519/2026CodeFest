import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoNav } from '../demoNav'
import type { DemoView } from '../demoNav'

describe('destination direction', () => {
  afterEach(() => vi.useRealTimers())

  it('points directly to the destination separately from the route and follows phone heading', () => {
    vi.useFakeTimers()
    let view: DemoView | undefined
    const nav = createDemoNav((next) => { view = next })
    nav.setSpeed(0)
    nav.start()
    const initial = view!
    expect(initial.destinationDeg).not.toBeNull()
    expect(initial.destinationDeg! - initial.arrowDeg).toBeGreaterThan(20)

    nav.joystick({ forward: 0, right: 1 })
    vi.advanceTimersByTime(100)
    const destinationChange = view!.destinationDeg! - initial.destinationDeg!
    const arrowChange = view!.arrowDeg - initial.arrowDeg
    expect(destinationChange).toBeGreaterThan(-92)
    expect(destinationChange).toBeLessThan(-89)
    expect(destinationChange).toBeCloseTo(arrowChange, 5)
    nav.force('arrived')
    expect(view!.destinationDeg).toBeNull()
    nav.stop()
  })
})
