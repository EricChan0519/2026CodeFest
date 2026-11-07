/**
 * 模擬行走（?demo=1）：位置沿著內建路線前進，朝向用真實羅盤；沒有羅盤時用 setManualHeading（滑桿）。
 * 不連網。事件由 tick(dtS) 產生，start() 內用 setInterval 每秒呼叫一次；測試直接呼叫 tick。
 */
import { distanceM, lerpLatLon } from '@/nav/geo'
import type { LatLon } from '@/lib/contract'
import type { PermissionResult, SensorHandlers, SensorSource } from './source'

export interface ReplayOptions {
  geometry: LatLon[]
  speedMps?: number
  /** 提供真實羅盤（通常是 new WebSensorSource({ position: false })）；不給就只靠 setManualHeading */
  headingSource?: SensorSource
  /** 回報的定位精度（公尺） */
  accuracyM?: number
  now?: () => number
}

export class ReplaySensorSource implements SensorSource {
  private handlers: SensorHandlers | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private cum: number[] = [0]
  private alongM = 0
  private paused = false
  private offset: [number, number] = [0, 0]

  private readonly opts: ReplayOptions

  constructor(opts: ReplayOptions) {
    this.opts = opts
    const g = opts.geometry
    for (let i = 1; i < g.length; i++) this.cum.push(this.cum[i - 1]! + distanceM(g[i - 1]!, g[i]!))
  }

  get totalM(): number {
    return this.cum[this.cum.length - 1] ?? 0
  }

  get progressM(): number {
    return this.alongM
  }

  requestPermission(): Promise<PermissionResult> {
    return this.opts.headingSource?.requestPermission() ?? Promise.resolve('not_needed')
  }

  start(handlers: SensorHandlers): void {
    this.stop()
    this.handlers = handlers
    this.opts.headingSource?.start({
      onHeading: handlers.onHeading,
      onPosition: () => {}, // 位置一律來自路線
      onError: (c) => {
        if (c === 'no_heading_sensor') handlers.onError(c)
      },
    })
    this.emit()
    this.timer = setInterval(() => this.tick(1), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.opts.headingSource?.stop()
    this.handlers = null
  }

  /** 位置來自路線不用重接，只有真實羅盤需要 */
  resync(): void {
    this.opts.headingSource?.resync?.()
  }

  setPaused(p: boolean) {
    this.paused = p
  }

  /** 回到起點 */
  restart() {
    this.alongM = 0
    this.offset = [0, 0]
    this.emit()
  }

  /** 讓位置偏離路線 east/north 公尺，用來測試走偏。傳 [0,0] 回到路線上。 */
  setOffset(eastM: number, northM: number) {
    this.offset = [eastM, northM]
    this.emit()
  }

  /** 沒有羅盤時，用滑桿手動給朝向（相對磁北） */
  setManualHeading(deg: number) {
    this.handlers?.onHeading(deg)
  }

  /** 前進 dtS 秒 */
  tick(dtS: number) {
    if (this.paused || !this.handlers) return
    this.alongM = Math.min(this.totalM, this.alongM + (this.opts.speedMps ?? 1.4) * dtS)
    this.emit()
  }

  private pointAlong(): LatLon {
    const g = this.opts.geometry
    if (g.length === 0) return [0, 0]
    if (g.length === 1 || this.alongM <= 0) return g[0]!
    let i = 1
    while (i < g.length - 1 && this.cum[i]! < this.alongM) i++
    const seg = this.cum[i]! - this.cum[i - 1]!
    return lerpLatLon(g[i - 1]!, g[i]!, seg === 0 ? 0 : (this.alongM - this.cum[i - 1]!) / seg)
  }

  private emit() {
    if (!this.handlers) return
    const [lat, lon] = this.pointAlong()
    const [e, n] = this.offset
    const cosLat = Math.cos((lat * Math.PI) / 180)
    this.handlers.onPosition({
      lat: lat + n / 111320,
      lon: lon + e / (111320 * cosLat),
      accuracyM: this.opts.accuracyM ?? 8,
      ts: (this.opts.now ?? Date.now)(),
    })
  }
}
