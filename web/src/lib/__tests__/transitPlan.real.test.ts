/**
 * 用 repo 裡的真實快照（TDX 公車站位、TDX 捷運）跑幾條常見路線，確認結果合理、速度夠快。
 * 快照不在時略過。
 */
import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/contract'
import type { MetroIndex } from '@/lib/metroIndex'
import { buildStopIndex } from '@/lib/stopSearch'
import { planTransit } from '@/lib/transitPlan'

const stopFiles = import.meta.glob('../../../public/lab/stop_index.json', { eager: true, import: 'default' })
const metroFiles = import.meta.glob('../../../public/lab/metro_index.json', { eager: true, import: 'default' })
const stopRaw = Object.values(stopFiles)[0] as Parameters<typeof buildStopIndex>[0] | undefined
const metro = Object.values(metroFiles)[0] as MetroIndex | undefined

const TAIPEI_MAIN: LatLon = [25.0478, 121.517]
const TAIPEI_101: LatLon = [25.0336, 121.5648]
const TIANMU_SOGO: LatLon = [25.1145, 121.5304]

describe.skipIf(!stopRaw || !metro)('planTransit on the real snapshots', () => {
  const idx = stopRaw ? buildStopIndex(stopRaw) : null
  const bus = { stations: idx?.stations ?? [], patterns: idx?.patterns ?? [] }

  it('Taipei Main Station → Taipei 101 has bus, metro and mixed plans', () => {
    const t0 = performance.now()
    const plans = planTransit(bus, metro!, TAIPEI_MAIN, TAIPEI_101, { audience: 'visitor' })
    const ms = performance.now() - t0
    console.log(`first plan (builds graph) ${ms.toFixed(0)} ms`)
    for (const tab of ['mixed', 'bus', 'metro'] as const) {
      expect(plans[tab].length).toBeGreaterThan(0)
      console.log(tab, plans[tab].map((p) => `${Math.round(p.durationS / 60)}min ` + p.rides.map((r) => `${r.route.routeName.zh}(${r.board.name.zh}→${r.alight.name.zh})`).join(' > ')))
    }
    expect(plans.metro[0].rides.every((r) => r.mode === 'metro')).toBe(true)
    expect(plans.metro[0].durationS).toBeLessThan(40 * 60)
  })

  it('a second plan reuses the graph and stays fast', () => {
    const t0 = performance.now()
    const plans = planTransit(bus, metro!, TIANMU_SOGO, TAIPEI_MAIN, { audience: 'elder' })
    const ms = performance.now() - t0
    console.log(`second plan ${ms.toFixed(0)} ms`)
    console.log('mixed', plans.mixed.map((p) => `${Math.round(p.durationS / 60)}min ` + p.rides.map((r) => `${r.route.routeName.zh}(${r.board.name.zh}→${r.alight.name.zh})`).join(' > ')))
    expect(plans.mixed.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(2000)
  })
  it('runs at noon and is over at 01:30 (Taipei Main Station → Taipei 101)', () => {
    const noon = planTransit(bus, metro!, TAIPEI_MAIN, TAIPEI_101, { audience: 'visitor', now: new Date(2026, 10, 9, 12, 0) })
    expect(noon.metro[0].service).toBe('ok')
    expect(noon.bus[0].service).toBe('ok')
    const night = planTransit(bus, metro!, TAIPEI_MAIN, TAIPEI_101, { audience: 'visitor', now: new Date(2026, 10, 10, 1, 30) })
    const summary = (tab: 'metro' | 'bus') => night[tab].map((p) => `${p.rides.map((r) => r.route.routeName.zh).join('→')}:${p.service}`)
    console.log('01:30 metro', summary('metro'), 'bus', summary('bus'))
    expect(night.metro.every((p) => p.service !== 'ok')).toBe(true)
    expect(night.bus.every((p) => p.service !== 'ok')).toBe(true)
  })
})
