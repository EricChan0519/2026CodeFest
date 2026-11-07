/**
 * 網頁羅盤與定位。見 docs/arrow-nav/04-nav-logic.md#感測資料 與 ADR-0003。
 * - Android：deviceorientationabsolute（alpha/beta/gamma → heading.ts）
 * - iOS：deviceorientation 的 webkitCompassHeading（沒有 Mac，只能在 Safari 驗證，WebView 內待驗證）
 * 兩者都是相對磁北；磁偏角由 nav 層統一加。
 */
import { headingFromOrientation } from './heading'
import type { PermissionResult, SensorHandlers, SensorSource } from './source'

/** 原始事件資訊，給 /lab/sensors 顯示用 */
export interface RawOrientation {
  eventName: 'deviceorientationabsolute' | 'deviceorientation'
  alpha: number | null
  beta: number | null
  gamma: number | null
  absolute: boolean
  webkitCompassHeading: number | null
}

export interface WebSensorOptions {
  /** false 時不啟動定位（replay 只要真實羅盤時用） */
  position?: boolean
  onRaw?: (r: RawOrientation) => void
}

/** 三個角度都是有限數字才算朝向（有些裝置會送 NaN 或 null），否則回 null */
function orientationHeading(a: number | null, b: number | null, g: number | null): number | null {
  if (a === null || b === null || g === null) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(g)) return null
  return headingFromOrientation(a, b, g)
}

type IOSOrientationCtor = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export class WebSensorSource implements SensorSource {
  private watchId: number | null = null
  private cleanups: Array<() => void> = []
  private handlers: SensorHandlers | null = null
  private readonly opts: WebSensorOptions

  constructor(opts: WebSensorOptions = {}) {
    this.opts = opts
  }

  async requestPermission(): Promise<PermissionResult> {
    const ctor = (globalThis as { DeviceOrientationEvent?: IOSOrientationCtor }).DeviceOrientationEvent
    if (ctor && typeof ctor.requestPermission === 'function') {
      try {
        return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied'
      } catch {
        return 'denied'
      }
    }
    return 'not_needed'
  }

  start(handlers: SensorHandlers): void {
    this.stop() // 重複 start 不累積監聽
    this.handlers = handlers
    this.attach(handlers)
  }

  stop(): void {
    this.detach()
    this.handlers = null
  }

  /**
   * 拆掉再重新註冊羅盤監聽與定位 watch。
   * 部分 WebView 在頁面進背景、切回來後，deviceorientation 事件不再送或數值卡住，重新註冊就會恢復。
   */
  resync(): void {
    const h = this.handlers
    if (!h) return
    this.detach()
    this.attach(h)
  }

  private attach(h: SensorHandlers): void {
    this.startHeading(h)
    if (this.opts.position !== false) this.startPosition(h)
  }

  private detach(): void {
    this.cleanups.forEach((f) => f())
    this.cleanups = []
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId)
    }
    this.watchId = null
  }

  private startHeading(h: SensorHandlers): void {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      h.onError('no_heading_sensor')
      return
    }
    const onAbs = (e: Event) => {
      const ev = e as DeviceOrientationEvent
      this.opts.onRaw?.({
        eventName: 'deviceorientationabsolute',
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
        absolute: ev.absolute,
        webkitCompassHeading: null,
      })
      const hd = orientationHeading(ev.alpha, ev.beta, ev.gamma)
      if (hd !== null) h.onHeading(hd)
    }
    const onRel = (e: Event) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number }
      const compass = typeof ev.webkitCompassHeading === 'number' ? ev.webkitCompassHeading : null
      this.opts.onRaw?.({
        eventName: 'deviceorientation',
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
        absolute: ev.absolute,
        webkitCompassHeading: compass,
      })
      if (compass !== null && Number.isFinite(compass)) {
        h.onHeading(compass) // iOS：已經是相對磁北的朝向
      } else if (ev.absolute) {
        const hd = orientationHeading(ev.alpha, ev.beta, ev.gamma)
        if (hd !== null) h.onHeading(hd)
      }
      // 其餘情況 alpha 是相對值，不可當羅盤用
    }
    if ('ondeviceorientationabsolute' in (window as object)) {
      window.addEventListener('deviceorientationabsolute', onAbs)
      this.cleanups.push(() => window.removeEventListener('deviceorientationabsolute', onAbs))
    } else {
      window.addEventListener('deviceorientation', onRel)
      this.cleanups.push(() => window.removeEventListener('deviceorientation', onRel))
    }
  }

  private startPosition(h: SensorHandlers): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      h.onError('location_off')
      return
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) =>
        h.onPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          ts: pos.timestamp,
        }),
      (err) => h.onError(err.code === err.PERMISSION_DENIED ? 'location_denied' : 'location_off'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    )
  }
}
