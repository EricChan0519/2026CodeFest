import { describe, expect, it } from 'vitest'
import { buildRide } from '../ride'

const trip = {
  station: { zh: '臺北車站(忠孝)', en: 'Taipei Main Sta.' },
  route: { zh: '307', en: '307' },
  headsign: { zh: '往板橋', en: 'To Banqiao' },
  alight: { zh: '板橋車站', en: 'Banqiao Station' },
}

describe('buildRide', () => {
  it('shows the bus, where to get off and how many stops are left', () => {
    const r = buildRide(trip, 'zh-TW', 'visitor', { index: 0, remaining: 5, cue: 'none' })
    expect(r.routeBig).toBe('307')
    expect(r.direction).toBe('往板橋')
    expect(r.getOff).toBe('在 板橋車站 下車')
    expect(r.stopsLeft).toBe('還有 5 站')
    expect(r.cueText).toBeNull()
    expect(r.labels.gotOff).toBe('下車了')
  })

  it('warns one stop before and tells you to get off at the stop', () => {
    expect(buildRide(trip, 'zh-TW', 'visitor', { index: 4, remaining: 1, cue: 'next_stop' }).cueText).toBe('下一站 板橋車站，準備下車')
    expect(buildRide(trip, 'zh-TW', 'visitor', { index: 5, remaining: 0, cue: 'get_off' }).cueText).toBe('到了，請在 板橋車站 下車')
  })

  it('speaks slowly for elders and uses the chosen language', () => {
    const r = buildRide(trip, 'en', 'elder', { index: 0, remaining: 3, cue: 'none' })
    expect(r.stopsLeft).toBe('3 stops to go')
    expect(r.rate).toBe('slow')
    expect(r.speechLang).toBe('en-US')
  })
})
