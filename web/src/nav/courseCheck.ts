/**
 * 定期確認羅盤有沒有指對：把「GPS 走出去的方向」和「這段時間手機的朝向」比。
 * 假設：導航時人是拿著手機朝前走，所以走向 ≈ 手機朝向。
 * 只在這些條件都成立時才採樣：定位夠準、走了夠遠、速度像走路、這段時間朝向沒有大幅轉動。
 * 連續幾次採樣都有一致的偏差，才說「可能不準」（suspect）；偏差小就是「正常」（ok）。
 * 純函式風格，不碰計時器與 DOM。
 */
import type { NavConfig } from './config'
import { angleDiff, bearingDeg, deg, distanceM, norm360, rad } from './geo'

export type CourseVerdict = 'unknown' | 'ok' | 'suspect'

export type CourseCheckConfig = Pick<
  NavConfig,
  | 'courseMaxAccuracyM'
  | 'courseMinMoveM'
  | 'courseMinSpeedMps'
  | 'courseMaxSpeedMps'
  | 'courseMinConsistency'
  | 'courseSamples'
  | 'courseMismatchDeg'
  | 'courseOkDeg'
  | 'courseSpreadDeg'
>

export interface CoursePoint {
  lat: number
  lon: number
  accuracyM: number
}

export interface CourseCheck {
  /** 餵目前的（真北）朝向 */
  pushHeading(trueDeg: number): void
  /** 餵一筆定位，回傳目前的判斷 */
  pushPosition(p: CoursePoint, now: number): CourseVerdict
  /** 全部重來（換路線、使用者手動重新定位） */
  reset(): void
  /** 只清掉採樣，保留目前判斷（觸發重新定位之後，重新取樣來驗證） */
  clearSamples(): void
  readonly verdict: CourseVerdict
  /** 最近一次判斷用的平均偏差（走向 − 朝向，度，正＝羅盤偏逆時針），沒有則為 null */
  readonly offsetDeg: number | null
}

/** 方向的圓平均與偏差，回傳 [平均, 一致程度 0–1] */
function circularMean(degs: number[]): [number, number] {
  let x = 0
  let y = 0
  for (const d of degs) {
    x += Math.cos(rad(d))
    y += Math.sin(rad(d))
  }
  const n = degs.length || 1
  return [norm360(deg(Math.atan2(y, x))), Math.hypot(x, y) / n]
}

export function createCourseCheck(cfg: CourseCheckConfig): CourseCheck {
  let anchor: (CoursePoint & { at: number }) | null = null
  let hx = 0
  let hy = 0
  let hn = 0
  let samples: number[] = []
  let verdict: CourseVerdict = 'unknown'
  let offset: number | null = null

  function resetAnchor() {
    anchor = null
    hx = 0
    hy = 0
    hn = 0
  }

  function judge() {
    if (samples.length < cfg.courseSamples) return
    const recent = samples.slice(-cfg.courseSamples)
    const [mean] = circularMean(recent)
    const meanDiff = angleDiff(mean, 0)
    const spread = Math.max(...recent.map((d) => Math.abs(angleDiff(d, mean))))
    offset = meanDiff
    if (spread > cfg.courseSpreadDeg) return // 太散，不下判斷，保留原本結果
    if (Math.abs(meanDiff) >= cfg.courseMismatchDeg) verdict = 'suspect'
    else if (recent.every((d) => Math.abs(angleDiff(d, 0)) <= cfg.courseOkDeg)) verdict = 'ok'
  }

  return {
    pushHeading(trueDeg) {
      hx += Math.cos(rad(trueDeg))
      hy += Math.sin(rad(trueDeg))
      hn++
    },
    pushPosition(p, now) {
      if (p.accuracyM > cfg.courseMaxAccuracyM) return verdict
      if (!anchor) {
        anchor = { ...p, at: now }
        hx = hy = hn = 0
        return verdict
      }
      const moved = distanceM([anchor.lat, anchor.lon], [p.lat, p.lon])
      const need = Math.max(cfg.courseMinMoveM, 1.5 * Math.max(anchor.accuracyM, p.accuracyM))
      if (moved < need) {
        // 站著不動太久：重新開始，避免之後把「等了很久才走」當成慢速
        if (now - anchor.at > 30_000) resetAnchor()
        return verdict
      }

      const dtS = (now - anchor.at) / 1000
      const speed = dtS > 0 ? moved / dtS : 0
      const consistency = hn > 0 ? Math.hypot(hx, hy) / hn : 0
      if (hn > 0 && speed >= cfg.courseMinSpeedMps && speed <= cfg.courseMaxSpeedMps && consistency >= cfg.courseMinConsistency) {
        const course = bearingDeg([anchor.lat, anchor.lon], [p.lat, p.lon])
        const meanHeading = norm360(deg(Math.atan2(hy, hx)))
        samples.push(angleDiff(course, meanHeading))
        if (samples.length > 8) samples = samples.slice(-8)
        judge()
      }
      anchor = { ...p, at: now }
      hx = hy = hn = 0
      return verdict
    },
    reset() {
      resetAnchor()
      samples = []
      verdict = 'unknown'
      offset = null
    },
    clearSamples() {
      resetAnchor()
      samples = []
    },
    get verdict() {
      return verdict
    },
    get offsetDeg() {
      return offset
    },
  }
}
