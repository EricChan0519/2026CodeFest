/**
 * 導航狀態機。事件進、畫面快照出，沒有計時器、沒有 DOM、不呼叫 API。
 * 要拿新路線時送出 effect，由外部取得後呼叫 routeResult()。
 * 狀態圖見 docs/arrow-nav/04-nav-logic.md#狀態。
 */
import type { LatLon, RouteOption, SensorErrorCode } from '@/lib/contract'
import type { PositionFix } from '@/sensors/source'
import { arrowAngle, directionKey, nextCssRotation } from './arrow'
import type { DirectionKey } from './arrow'
import { NAV_CONFIG, arriveRadiusM, offRouteM } from './config'
import type { NavConfig } from './config'
import { createCourseCheck } from './courseCheck'
import type { CourseVerdict } from './courseCheck'
import { angleDiff, bearingDeg, norm360 } from './geo'
import { createHeadingFilter } from './headingFilter'
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

/** 為什麼要重新接上感測器／重新定位 */
export type ResyncReason = 'manual' | 'resumed' | 'heading_silent' | 'heading_frozen' | 'course_mismatch'

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
  /** 羅盤 vs GPS 走向的定期檢查：unknown 還沒資料；ok 正常；suspect 可能不準（請使用者畫 8 字） */
  headingCheck: CourseVerdict
  /** 最近一次檢查的平均偏差（走向 − 朝向，度），除錯用 */
  headingOffsetDeg: number | null
  routeId: string | null
}

export interface NavMachineOptions {
  route?: NavRoute | null
  cfg?: NavConfig
  now?: () => number
  /** 是否用 GPS 走向定期檢查羅盤；位置是模擬的（replay）時要關掉。預設開 */
  courseCheck?: boolean
}

export interface NavMachine {
  start(): void
  onPosition(p: PositionFix): void
  /** 相對磁北的朝向，磁偏角在這裡加 */
  onHeading(magneticDeg: number): void
  onError(code: SensorErrorCode): void
  /** 外部每秒呼叫一次，處理逾時；偵測到感測器沒資料或卡住時會觸發 onResync */
  tick(): void
  /**
   * 重新定位：忘掉平滑中的朝向、重算方向檢查。呼叫端要另外請感測器重新接上（SensorSource.resync）。
   * 使用者按「重新定位」、頁面回到前景時呼叫。
   */
  resync(): void
  /** 機器覺得該重新接上感測器時通知（沒有朝向事件、數值卡住、方向檢查不符），呼叫端去 source.resync() */
  onResync(fn: (reason: ResyncReason) => void): () => void
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
  const filter = createHeadingFilter(cfg)
  const course = createCourseCheck(cfg)
  const courseEnabled = opts.courseCheck !== false
  let started = false
  let lastHeadingAt: number | null = null
  let lastRaw: number | null = null
  let lastRawChangeAt = 0
  let lastResyncAt: number | null = null
  let lastCourseResyncAt: number | null = null
  let noCompass = false
  let startedAt = 0
  let offCount = 0
  let arriveCount = 0
  let lastRerouteAt: number | null = null
  let css = 0
  let view: NavView
  const viewSubs = new Set<(v: NavView) => void>()
  const effectSubs = new Set<(e: NavEffect) => void>()
  const resyncSubs = new Set<(r: ResyncReason) => void>()

  function emitEffect(e: NavEffect) {
    effectSubs.forEach((f) => f(e))
  }

  function emitResync(reason: ResyncReason, now: number) {
    lastResyncAt = now
    resyncSubs.forEach((f) => f(reason))
  }

  /** 方向檢查發現羅盤與走向不符：重新接上感測器一次（有冷卻），之後重新取樣驗證 */
  function maybeCourseResync(now: number) {
    if (lastCourseResyncAt !== null && now - lastCourseResyncAt < cfg.courseResyncCooldownS * 1000) return
    lastCourseResyncAt = now
    filter.reset()
    course.clearSamples()
    emitResync('course_mismatch', now)
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
    const hdeg = filter.value
    if (hasArrowState && lastPos && hdeg !== null && target && !headingLost) {
      const bearing = bearingDeg([lastPos.lat, lastPos.lon], target)
      arrowDeg = arrowAngle(bearing, hdeg)
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
      headingDeg: hdeg,
      headingCheck: course.verdict,
      headingOffsetDeg: course.offsetDeg,
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
      started = true
      startedAt = clock()
      lastRawChangeAt = startedAt
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
      if (courseEnabled && course.pushPosition(p, now) === 'suspect') maybeCourseResync(now)
      if (state === 'locating') {
        state = 'routing'
        emitEffect({ type: 'fetchRoute', from: [p.lat, p.lon], candidate: null })
      } else if (state === 'navigating' || state === 'weak_signal' || state === 'back_to_route') {
        process(p, now)
      }
      publish()
    },

    onHeading(magneticDeg) {
      const now = clock()
      if (lastRaw === null || Math.abs(angleDiff(magneticDeg, lastRaw)) > 0.05) lastRawChangeAt = now
      lastRaw = magneticDeg
      const h = filter.update(norm360(magneticDeg + cfg.declinationDeg), now)
      if (courseEnabled) course.pushHeading(h)
      lastHeadingAt = now
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
      // 感測器沒資料或數值卡住：請外部重新接上（有冷卻，避免一直重接）
      if (started && !noCompass && state !== 'failed' && state !== 'arrived') {
        const cooled = lastResyncAt === null || now - lastResyncAt >= cfg.resyncCooldownS * 1000
        const silent = now - (lastHeadingAt ?? startedAt) > cfg.headingStaleS * 1000
        const frozen = lastHeadingAt !== null && now - lastRawChangeAt > cfg.headingFrozenS * 1000
        if (cooled && (silent || frozen)) emitResync(silent ? 'heading_silent' : 'heading_frozen', now)
      }
      publish()
    },

    resync() {
      const now = clock()
      filter.reset() // 下一筆朝向直接採用，不從舊值慢慢轉
      course.reset()
      lastRaw = null
      lastRawChangeAt = now
      lastResyncAt = now // 自動偵測先等一個冷卻時間，避免剛重接就又觸發
      publish()
    },

    onResync(fn) {
      resyncSubs.add(fn)
      return () => resyncSubs.delete(fn)
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
