import { describe, expect, it } from 'vitest'
import { createNavMachine } from '../machine'
import { createTraceRecorder } from '../trace'
import { STRAIGHT, pt } from '../__fixtures__/routes'

describe('trace recorder', () => {
  it('records route, positions, throttled headings and changed views', () => {
    let t = 0
    const rec = createTraceRecorder('route', { now: () => t, minHeadingGapMs: 200 })
    const m = createNavMachine({ route: STRAIGHT, now: () => t })
    m.subscribe((v) => rec.view(v))
    rec.route(STRAIGHT)
    m.start()
    for (let i = 0; i < 5; i++) {
      t += 50
      rec.heading(4.7)
      m.onHeading(4.7)
    }
    const [lat, lon] = pt(0, 10)
    const fix = { lat, lon, accuracyM: 8, ts: t }
    rec.position(fix)
    m.onPosition(fix)

    const trace = rec.toJSON()
    expect(trace.version).toBe(1)
    expect(trace.events.filter((e) => e.k === 'route')).toHaveLength(1)
    expect(trace.events.filter((e) => e.k === 'pos')).toHaveLength(1)
    expect(trace.events.filter((e) => e.k === 'hdg').length).toBeLessThanOrEqual(2)
    const views = trace.events.filter((e) => e.k === 'view')
    expect(views.at(-1)).toMatchObject({ k: 'view', state: 'navigating', arrowDeg: 0 })
    // 朝向沒變時，同樣的畫面不重複記
    expect(views.length).toBeLessThan(5)
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
  })
})
