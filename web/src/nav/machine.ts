/**
 * 導航狀態機。事件進、畫面快照出，沒有計時器、沒有 DOM、不呼叫 API。
 * 要拿新路線時送出 effect，由外部取得後呼叫 routeResult()。
 * 狀態圖見 docs/arrow-nav/04-nav-logic.md#狀態。
 */
import type { LatLon, RouteOption, SensorErrorCode } from '@/lib/contract'
import type { PositionFix } from '@/sensors/source'
import { arrowAngle, directionKey, nextCssRotation, smoothHeading } from './arrow'
import type { DirectionKey, HeadingVec } from './arrow'
import { NAV_CONFIG, arriveRadiusM, offRouteM } from './config'
import type { NavConfig } from './config'
import { bearingDeg, norm360 } from './geo'
import { createTracker } from './tracker'
import type { TrackState, Tracker } from './tracker'

export type NavState =
  | 'locating'
  | 'routing'
  | 'navigating'
  | 'weak_signal'
  | 'rerouting'
  | 'back_to_route'
  | 'arrived'
  | 'failed'

export type FailReason = 'location_denied' | 'location_off' | 'route_failed'

export type NavRoute = Pick<RouteOption, 'geometry' | 'maneuvers'> & { id?: string }

/** 外部要做的事 */
export type NavEffect = { type: 'fetchRoute'; from: LatLon; candidate: string | null }

export interface NavView {
  state: NavState
  failReason: FailReason | null
  /** 超過 headingLostS 沒有朝向事件，或手機沒有羅盤 */
  headingLost: boolean
  hasPosition: boolean
  accuracyM: number | null
  /** navigating／weak／rerouting：沿路線剩餘；back_to_route：離路線多遠 */
  distanceM: number | null
  /** 箭頭相對手機上緣的角度 0–360；不顯示箭頭時為 null */
  arrowDeg: number | null
  /** 給 CSS rotate() 用，走最短方向，可超過 360 */
  cssRotation: number
  direction: DirectionKey | null
  /** 空心箭頭：weak_signal、rerouting */
  hollowArrow: boolean
  nextTurn: TrackState['nextTurn']
  /** 路線已走比例 0–1 */
  progress: number
  /** 平滑後的真北朝向，除錯用 */
  headingDeg: number | null
  routeId: string | null
}

export interface NavMachineOptions {
  route?: NavRoute | null
  cfg?: NavConfig
  now?: () => number
}

export interface NavMachine {
  start(): void
  onPosition(p: PositionFix): void
  /** 相對磁北的朝向，磁偏角在這裡加 */
  onHeading(magneticDeg: number): void
  onError(code: SensorErrorCode): void
  /** 外部每秒呼叫一次，處理逾時 */
  tick(): void
  /** 回覆 fetchRoute；null 表示失敗 */
  routeResult(route: NavRoute | null): void
  subscribe(fn: (v: NavView) => void): () => void
  onEffect(fn: (e: NavEffect) => void): () => void
  getView(): NavView
}

export function createNavMachine(opts: NavMachineOptions = {}): NavMachine {
  const cfg = opts.cfg ?? NAV_CONFIG
  const clock = opts.now ?? Date.now

  let state: NavState = 'locating'
  let failReason: FailReason | null = null
  let route: NavRoute | null = opts.route ?? null
  let tracker: Tracker | null = null
  let track: TrackState | null = null
  let lastPos: PositionFix | null = null
  let lastPosAt = 0
  let hv: HeadingVec | null = null
  let lastHeadingAt: number | null = null
  let noCompass = false
  let startedAt = 0
  let offCount = 0
  let arriveCount = 0
  let lastRerouteAt: number | null = null
  let css = 0
  let view: NavView
  const viewSubs = new Set<(v: NavView) => void>()
  const effectSubs = new Set<(e: NavEffect) => void>()

  function emitEffect(e: NavEffect) {
    effectSubs.forEach((f) => f(e))
  }

  function setRoute(r: NavRoute) {
    route = r
    tracker = createTracker(r, cfg)
    track = null
    offCount = 0
    arriveCount = 0
  }

  function fail(reason: FailReason) {
    state = 'failed'
    failReason = reason
  }

  function cooldownOk(now: number): boolean {
    return lastRerouteAt === null || now - lastRerouteAt >= cfg.rerouteCooldownS * 1000
  }

  /** navigating／weak_signal／back_to_route 時處理一筆定位 */
  function process(p: PositionFix, now: number) {
    if (!tracker) return
    if (p.accuracyM > cfg.weakAccuracyM) {
      if (state === 'navigating' || state === 'back_to_route') state = 'weak_signal'
      offCount = 0
      arriveCount = 0
      return
    }
    if (state === 'weak_signal') state = 'navigating'

    const here: LatLon = [p.lat, p.lon]
    track = tracker.update(here)

    // 抵達：連續 arriveHits 次進入範圍
    arriveCount = track.distToEndM <= arriveRadiusM(p.accuracyM) ? arriveCount + 1 : 0
    if (arriveCount >= cfg.arriveHits) {
      state = 'arrived'
      return
    }

    // 偏離：連續 offRouteHits 次才算
    if (track.offRouteM > offRouteM(p.accuracyM)) {
      offCount++
    } else {
      offCount = 0
      if (state === 'back_to_route') state = 'navigating'
    }
    if (offCount >= cfg.offRouteHits) {
      if (cooldownOk(now)) {
        state = 'rerouting'
        lastRerouteAt = now
        offCount = 0
        emitEffect({ type: 'fetchRoute', from: here, candidate: route?.id ?? null })
      } else if (state === 'navigating') {
        state = 'back_to_route'
      }
    }
  }

  function computeView(): NavView {
    const hasArrowState =
      state === 'navigating' || state === 'weak_signal' || state === 'rerouting' || state === 'back_to_route'
    const target = state === 'back_to_route' ? track?.nearest : track?.target
    let arrowDeg: number | null = null
    let direction: DirectionKey | null = null
    const headingLost = noCompass || clock() - (lastHeadingAt ?? startedAt) > cfg.headingLostS * 1000
    if (hasArrowState && lastPos && hv && target && !headingLost) {
      const bearing = bearingDeg([lastPos.lat, lastPos.lon], target)
      arrowDeg = arrowAngle(bearing, hv.deg)
      css = nextCssRotation(css, arrowDeg)
      direction = directionKey(arrowDeg)
    }
    const distanceM = !track
      ? null
      : state === 'back_to_route'
        ? track.offRouteM
        : state === 'arrived'
          ? 0
          : track.remainingM
    const total = tracker?.totalM ?? 0
    return {
      state,
      failReason,
      headingLost,
      hasPosition: lastPos !== null,
      accuracyM: lastPos?.accuracyM ?? null,
      distanceM,
      arrowDeg,
      cssRotation: css,
      direction,
      hollowArrow: state === 'weak_signal' || state === 'rerouting',
      nextTurn: track?.nextTurn ?? null,
      progress: total > 0 && track ? Math.min(1, track.alongM / total) : 0,
      headingDeg: hv ? hv.deg : null,
      routeId: route?.id ?? null,
    }
  }

  function publish() {
    view = computeView()
    viewSubs.forEach((f) => f(view))
  }

  view = computeView()

  return {
    start() {
      startedAt = clock()
      lastPosAt = startedAt
      failReason = null
      if (route) {
        // P5 已取得路線：直接從 navigating 開始
        setRoute(route)
        state = 'navigating'
      } else {
        state = 'locating'
      }
      publish()
    },

    onPosition(p) {
      const now = clock()
      lastPos = p
      lastPosAt = now
      if (state === 'locating') {
        state = 'routing'
        emitEffect({ type: 'fetchRoute', from: [p.lat, p.lon], candidate: null })
      } else if (state === 'navigating' || state === 'weak_signal' || state === 'back_to_route') {
        process(p, now)
      }
      publish()
    },

    onHeading(magneticDeg) {
      hv = smoothHeading(hv, norm360(magneticDeg + cfg.declinationDeg), cfg.headingAlpha)
      lastHeadingAt = clock()
      publish()
    },

    onError(code) {
      if (code === 'no_heading_sensor' || code === 'sensor_error') {
        noCompass = true
      } else if (state === 'locating' || state === 'routing') {
        fail(code === 'location_denied' ? 'location_denied' : 'location_off')
      } else if (state === 'navigating' || state === 'back_to_route') {
        state = 'weak_signal'
      }
      publish()
    },

    tick() {
      const now = clock()
      if (
        (state === 'navigating' || state === 'back_to_route') &&
        now - lastPosAt > cfg.staleGpsS * 1000
      ) {
        state = 'weak_signal'
      }
      publish()
    },

    routeResult(r) {
      if (state === 'routing') {
        if (r) {
          setRoute(r)
          state = 'navigating'
          if (lastPos) process(lastPos, clock())
        } else {
          fail('route_failed')
        }
      } else if (state === 'rerouting') {
        if (r) {
          setRoute(r)
          state = 'navigating'
          if (lastPos) process(lastPos, clock())
        } else {
          // 重算失敗：用手上的路線把人帶回去
          state = 'back_to_route'
        }
      }
      publish()
    },

    subscribe(fn) {
      viewSubs.add(fn)
      return () => viewSubs.delete(fn)
    },
    onEffect(fn) {
      effectSubs.add(fn)
      return () => effectSubs.delete(fn)
    },
    getView: () => view,
  }
}
