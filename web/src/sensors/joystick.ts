/**
 * 圓形搖桿（實驗頁模擬 GPS 用）：把手指相對搖桿中心的位移換成移動量。
 * 往上推 = 往手機朝向前進；超出圓圈時保留方向、長度截到 1。
 */
export interface JoystickVector {
  /** -1–1，正值往前 */
  forward: number
  /** -1–1，正值往右 */
  right: number
  /** 搖桿頭要畫在哪（px，相對中心，已截在圓內） */
  knobX: number
  knobY: number
}

/** dx、dy 是螢幕座標（y 往下為正）；deadZone 是比例，避免手指輕碰就走 */
export function joystickVector(dx: number, dy: number, radiusPx: number, deadZone = 0.12): JoystickVector {
  const len = Math.hypot(dx, dy)
  const k = len > radiusPx ? radiusPx / len : 1
  const knobX = dx * k
  const knobY = dy * k
  const mag = Math.min(1, len / radiusPx)
  if (mag < deadZone) return { forward: 0, right: 0, knobX: len === 0 ? 0 : knobX, knobY: len === 0 ? 0 : knobY }
  return { forward: -knobY / radiusPx, right: knobX / radiusPx, knobX, knobY }
}
