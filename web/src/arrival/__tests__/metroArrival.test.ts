import { describe, expect, it } from 'vitest'
import { askCard, buildArrival, type ArrivalTrip } from '../arrival'
import { buildRide } from '../ride'

const metroTrip: ArrivalTrip = {
  station: { zh: '台北車站', en: 'Taipei Main Station' },
  route: { zh: '淡水信義線', en: 'Tamsui-Xinyi Line' },
  headsign: { zh: '往淡水', en: 'To Tamsui' },
  alight: { zh: '中山', en: 'Zhongshan' },
  mode: 'metro',
  lineColor: '#E3002C',
}

describe('metro arrival text', () => {
  it('says "change lines here" for an in-station transfer', () => {
    expect(buildArrival({ ...metroTrip, changeLine: true }, 'zh-TW', 'visitor').headline).toBe('在這裡換線')
    expect(buildArrival({ ...metroTrip, changeLine: true }, 'en', 'visitor').headline).toBe('Change lines here')
    expect(buildArrival(metroTrip, 'zh-TW', 'visitor').headline).toBe('到了')
  })

  it('passes the line colour to the card', () => {
    expect(buildArrival(metroTrip, 'zh-TW', 'visitor').lineColor).toBe('#E3002C')
  })

  it('asks for the metro line, not a bus', () => {
    expect(askCard(metroTrip, 'zh-TW')?.zh).toBe('我要搭 捷運淡水信義線，往淡水。請問是這班車嗎？')
  })

  it('tells which exit to leave by while riding', () => {
    const r = buildRide({ ...metroTrip, exit: 'M3' }, 'zh-TW', 'visitor', { index: 0, remaining: 1, cue: 'none' })
    expect(r.exitVia).toBe('從 M3 出口出站')
    expect(buildRide(metroTrip, 'zh-TW', 'visitor', { index: 0, remaining: 1, cue: 'none' }).exitVia).toBeNull()
  })
})
