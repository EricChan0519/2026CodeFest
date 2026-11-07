/**
 * 導航邏輯只依賴這個介面（docs/arrow-nav/03-contracts.md#網頁的感測介面）。
 * 實作：WebSensorSource（預設）、ReplaySensorSource（?demo=1）、HandlerSensorSource（備案）。
 */
import type { SensorErrorCode } from '@/lib/contract'

export interface PositionFix {
  lat: number
  lon: number
  accuracyM: number
  /** 毫秒時間戳 */
  ts: number
}

export interface SensorHandlers {
  /** 手機上緣朝向，相對磁北，0–360。磁偏角由 nav 層加。 */
  onHeading(deg: number): void
  onPosition(p: PositionFix): void
  onError(code: SensorErrorCode): void
}

export type PermissionResult = 'granted' | 'denied' | 'not_needed'

export interface SensorSource {
  /** iOS 羅盤權限要由按鈕觸發，「開始走」的點擊事件內呼叫 */
  requestPermission(): Promise<PermissionResult>
  start(handlers: SensorHandlers): void
  stop(): void
  /**
   * 重新接上感測器（拆掉再重新註冊監聽、重新要定位），用在回到前景後或感測器卡住時。
   * 沒有 start 過就什麼都不做。
   */
  resync?(): void
}
