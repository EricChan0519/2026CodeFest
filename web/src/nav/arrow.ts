/**
 * 箭頭計算：朝向平滑、箭頭角度、CSS 旋轉、方向文字。純函式。
 * 見 docs/arrow-nav/04-nav-logic.md#角度處理。
 */
import { deg, norm360, rad } from './geo'

export interface HeadingVec {
  x: number
  y: number
  /** 平滑後朝向，0–360 */
  deg: number
}

/**
 * 用向量平均平滑朝向，避免 359° 和 1° 平均成 180°。
 * prev 為 null 時直接採用這次的值。
 */
export function smoothHeading(prev: HeadingVec | null, headingDeg: number, alpha: number): HeadingVec {
  const cx = Math.cos(rad(headingDeg))
  const cy = Math.sin(rad(headingDeg))
  const x = prev ? (1 - alpha) * prev.x + alpha * cx : cx
  const y = prev ? (1 - alpha) * prev.y + alpha * cy : cy
  return { x, y, deg: norm360(deg(Math.atan2(y, x))) }
}

/**
 * 依「距離上一筆多久」算平滑係數：alpha = 1 − e^(−dt/τ)。
 * 固定 alpha 的話，事件頻率低（部分 WebView 只有 ~10 Hz）時箭頭會慢很多；依時間算則延遲固定約 τ。
 */
export function alphaForDt(dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return 0
  return 1 - Math.exp(-dtMs / tauMs)
}

/**
 * 畫面每一幀把顯示角度往目標靠（指數趨近，不會超過目標），取代 CSS transition。
 * CSS transition 每次事件都重新開始，會把箭頭再拖慢約 0.2 秒，且感測頻率低時會一格一格跳。
 */
export function easeRotation(current: number, target: number, dtMs: number, tauMs: number): number {
  const diff = target - current
  if (Math.abs(diff) < 0.1) return target
  return current + diff * alphaForDt(dtMs, tauMs)
}

/** 箭頭相對手機上緣的角度：(bearing − heading) mod 360 */
export function arrowAngle(bearing: number, heading: number): number {
  return norm360(bearing - heading)
}

/**
 * CSS 旋轉要走最短方向，否則 359° 到 1° 會轉一整圈。
 * 回傳的值可以超過 360 或小於 0，不要歸零。
 */
export function nextCssRotation(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180
  return current + delta
}

export type DirectionKey = 'straight' | 'bear_left' | 'bear_right' | 'left' | 'right' | 'turn_around'

/** 箭頭角度（左右對稱）→ 指令。<25 直走；25–60 稍微；60–150 轉；>150 向後轉 */
export function directionKey(angle: number): DirectionKey {
  const a = norm360(angle)
  const side = a > 180 ? 'left' : 'right'
  const m = a > 180 ? 360 - a : a
  if (m < 25) return 'straight'
  if (m < 60) return side === 'left' ? 'bear_left' : 'bear_right'
  if (m <= 150) return side
  return 'turn_around'
}
