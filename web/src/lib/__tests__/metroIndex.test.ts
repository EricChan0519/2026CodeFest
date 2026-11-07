import { describe, expect, it } from 'vitest'
import { checkMetroIndex, type MetroIndex } from '../metroIndex'
import mini from '../__fixtures__/metro_index.mini.json'

function base(): MetroIndex {
  return {
    updatedAt: '2026-11-07T23:30:00+08:00',
    defaults: [],
    lines: [{ lineId: 'BL', name: { zh: '板南線', en: 'Bannan Line' }, color: '#0070BD', headwayS: 300 }],
    stations: [
      { stationId: 'BL11', name: { zh: '西門', en: 'Ximen' }, lat: 25.0421, lon: 121.5081, exits: [] },
      { stationId: 'BL12', name: { zh: '台北車站', en: 'Taipei Main Station' }, lat: 25.0463, lon: 121.5174, exits: [] },
    ],
    patterns: [{ lineId: 'BL', headsign: { zh: '往南港展覽館', en: null }, stops: ['BL11', 'BL12'], runS: [120] }],
    transfers: [],
  }
}

describe('checkMetroIndex', () => {
  it('accepts a well-formed index', () => {
    expect(checkMetroIndex(base())).toEqual([])
  })

  it('rejects runS whose length is not stops - 1', () => {
    const d = base()
    d.patterns[0].runS = [120, 90]
    expect(checkMetroIndex(d)).toContain('patterns[0].runS length 2, expected 1')
  })

  it('rejects stops and transfers that name unknown stations', () => {
    const d = base()
    d.patterns[0].stops = ['BL11', 'BL99']
    d.transfers = [{ from: 'BL12', to: 'R10', walkS: 240 }]
    const errors = checkMetroIndex(d)
    expect(errors).toContain('patterns[0].stops[1] unknown station BL99')
    expect(errors).toContain('transfers[0].to unknown station R10')
  })

  it('rejects patterns on unknown lines and bad colors', () => {
    const d = base()
    d.patterns[0].lineId = 'XX'
    d.lines[0].color = 'blue'
    const errors = checkMetroIndex(d)
    expect(errors).toContain('patterns[0].lineId unknown line XX')
    expect(errors).toContain('lines[0].color must be #RRGGBB')
  })

  it('rejects transfers listed in one direction only', () => {
    const d = base()
    d.transfers = [{ from: 'BL11', to: 'BL12', walkS: 240 }]
    expect(checkMetroIndex(d)).toContain('transfers[0] BL11→BL12 has no reverse entry')
  })
})

// 正式快照（scripts/build_metro_index.py 產生）存在時也要符合合約
const snapshots = import.meta.glob('../../../public/lab/metro_index.json', { eager: true, import: 'default' })

describe.skipIf(Object.keys(snapshots).length === 0)('web/public/lab/metro_index.json snapshot', () => {
  it('matches the contract', () => {
    for (const data of Object.values(snapshots)) expect(checkMetroIndex(data as MetroIndex)).toEqual([])
  })
})

describe('metro_index.mini.json fixture', () => {
  it('matches the contract', () => {
    expect(checkMetroIndex(mini as MetroIndex)).toEqual([])
  })

  it('has an in-station transfer at Taipei Main Station both ways', () => {
    const t = (mini as MetroIndex).transfers
    expect(t).toContainEqual(expect.objectContaining({ from: 'BL12', to: 'R10' }))
    expect(t).toContainEqual(expect.objectContaining({ from: 'R10', to: 'BL12' }))
  })

  it('lists both directions of each line', () => {
    const p = (mini as MetroIndex).patterns
    for (const line of ['BL', 'R']) expect(p.filter((x) => x.lineId === line)).toHaveLength(2)
  })
})
