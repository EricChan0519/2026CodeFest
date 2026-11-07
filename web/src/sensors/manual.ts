/**
 * 方向鍵模擬 GPS（實驗頁用）：位置由按鈕／鍵盤／點地圖決定，朝向用真實羅盤或手動滑桿。
 * 不用出門就能在真實路線上測箭頭。每秒重送一次目前位置，避免被判斷成 GPS 太久沒更新。
 */
import { fromLocalXY, rad } from '@/nav/geo'
import type { LatLon } from '@/lib/contract'
import type { PermissionResult, SensorHandlers, SensorSource } from './source'

export interface ManualGpsOptions {
  start: LatLon
  /** 回報的定位精度（公尺） */
  accuracyM?: number
  /** 提供真實羅盤（通常是 new WebSensorSource({ position: false })） */
  headingSource?: SensorSource
  now?: () => number
}

export class ManualGpsSource implements SensorSource {
  private handlers: SensorHandlers | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private pos: LatLon
  private accuracyM: number
  private readonly opts: ManualGpsOptions

  constructor(opts: ManualGpsOptions) {
    this.opts = opts
    this.pos = opts.start
    this.accuracyM = opts.accuracyM ?? 5
  }

  get position(): LatLon {
    return this.pos
  }

  requestPermission(): Promise<PermissionResult> {
    return this.opts.headingSource?.requestPermission() ?? Promise.resolve('not_needed')
  }

  start(handlers: SensorHandlers): void {
    this.stop()
    this.handlers = handlers
    this.opts.headingSource?.start({
      onHeading: handlers.onHeading,
      onPosition: () => {}, // 位置一律來自方向鍵
      onError: (c) => {
        if (c === 'no_heading_sensor' || c === 'sensor_error') handlers.onError(c)
      },
    })
    this.emit()
    this.timer = setInterval(() => this.emit(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.opts.headingSource?.stop()
    this.handlers = null
  }

  /** 以 headingDeg（真北）為「前方」，往前 forwardM、往右 rightM 公尺 */
  step(headingDeg: number, forwardM: number, rightM: number): void {
    const h = rad(headingDeg)
    const east = Math.sin(h) * forwardM + Math.cos(h) * rightM
    const north = Math.cos(h) * forwardM - Math.sin(h) * rightM
    this.pos = fromLocalXY(this.pos, [east, north])
    this.emit()
  }

  moveTo(p: LatLon): void {
    this.pos = p
    this.emit()
  }

  setAccuracy(m: number): void {
    this.accuracyM = m
    this.emit()
  }

  private emit() {
    this.handlers?.onPosition({
      lat: this.pos[0],
      lon: this.pos[1],
      accuracyM: this.accuracyM,
      ts: (this.opts.now ?? Date.now)(),
    })
  }
}
