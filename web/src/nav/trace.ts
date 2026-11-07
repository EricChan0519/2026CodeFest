/**
 * 實測軌跡紀錄（實驗頁用）：把路線、定位、朝向、畫面狀態依時間記下來，下載成 JSON。
 * 拿回來可以餵進 createNavMachine 重現問題，做成測試。座標只存在使用者自己的手機，下載才會離開。
 */
import type { LatLon } from '@/lib/contract'
import type { PositionFix } from '@/sensors/source'
import type { NavRoute, NavView } from './machine'

export type TraceEvent =
  | { t: number; k: 'route'; route: NavRoute | null }
  | { t: number; k: 'pos'; lat: number; lon: number; acc: number }
  | { t: number; k: 'hdg'; deg: number }
  | {
      t: number
      k: 'view'
      state: NavView['state']
      arrowDeg: number | null
      headingDeg: number | null
      target: LatLon | null
      nextTurn: NavView['nextTurn']
      offM: number | null
    }

export interface Trace {
  version: 1
  mode: string
  startedAt: string
  events: TraceEvent[]
}

export interface TraceRecorder {
  route(r: NavRoute | null): void
  position(p: PositionFix): void
  /** 原始羅盤（相對磁北，和 onHeading 吃的一樣）；每 minHeadingGapMs 最多記一筆 */
  heading(magneticDeg: number): void
  view(v: NavView): void
  readonly count: number
  toJSON(): Trace
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d

export function createTraceRecorder(
  mode: string,
  opts: { now?: () => number; minHeadingGapMs?: number; maxEvents?: number } = {},
): TraceRecorder {
  const clock = opts.now ?? Date.now
  const gap = opts.minHeadingGapMs ?? 200
  const max = opts.maxEvents ?? 50_000
  const t0 = clock()
  const startedAt = new Date(t0).toISOString()
  const events: TraceEvent[] = []
  let lastHdgAt = -Infinity
  let lastViewKey = ''
  const push = (e: TraceEvent) => {
    if (events.length < max) events.push(e)
  }
  const t = () => clock() - t0

  return {
    route(r) {
      push({ t: t(), k: 'route', route: r ? { id: r.id, geometry: r.geometry, maneuvers: r.maneuvers } : null })
    },
    position(p) {
      push({ t: t(), k: 'pos', lat: round(p.lat, 7), lon: round(p.lon, 7), acc: round(p.accuracyM, 1) })
    },
    heading(deg) {
      const now = clock()
      if (now - lastHdgAt < gap) return
      lastHdgAt = now
      push({ t: now - t0, k: 'hdg', deg: round(deg, 1) })
    },
    view(v) {
      // 只記有變化的畫面，避免每個羅盤事件都存一筆
      const key = `${v.state}|${v.arrowDeg?.toFixed(0)}|${v.targetPoint?.join()}|${v.nextTurn?.index}`
      if (key === lastViewKey) return
      lastViewKey = key
      push({
        t: t(),
        k: 'view',
        state: v.state,
        arrowDeg: v.arrowDeg === null ? null : round(v.arrowDeg, 0),
        headingDeg: v.headingDeg === null ? null : round(v.headingDeg, 0),
        target: v.targetPoint ? [round(v.targetPoint[0], 7), round(v.targetPoint[1], 7)] : null,
        nextTurn: v.nextTurn,
        offM: v.state === 'back_to_route' ? v.distanceM : null,
      })
    },
    get count() {
      return events.length
    },
    toJSON: () => ({ version: 1, mode, startedAt, events: [...events] }),
  }
}
