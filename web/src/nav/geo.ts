/**
 * 距離、方位角、投影。純函式，不碰 DOM，不依賴 Vue。
 * 座標一律 WGS84，陣列 [lat, lon]。
 */
import type { LatLon } from '@/lib/contract'

const R = 6371008.8 // 地球平均半徑（公尺）
export const rad = (d: number): number => (d * Math.PI) / 180
export const deg = (r: number): number => (r * 180) / Math.PI

/** 大圓距離（haversine），公尺 */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 從 a 看 b 的方位角，相對真北、順時針，0–360 */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const p1 = rad(a[0])
  const p2 = rad(b[0])
  const dl = rad(b[1] - a[1])
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** 角度正規化到 [0, 360) */
export const norm360 = (d: number): number => ((d % 360) + 360) % 360

/** a − b 的最短帶號角度差，範圍 (−180, 180]：正值代表 a 在 b 的順時針方向 */
export function angleDiff(a: number, b: number): number {
  const d = norm360(a - b)
  return d > 180 ? d - 360 : d
}

/** 以 origin 為原點的局部平面座標（公尺），x 向東、y 向北。幾百公尺內誤差可忽略。 */
export function toLocalXY(origin: LatLon, p: LatLon): [number, number] {
  return [rad(p[1] - origin[1]) * Math.cos(rad(origin[0])) * R, rad(p[0] - origin[0]) * R]
}

export function fromLocalXY(origin: LatLon, xy: [number, number]): LatLon {
  return [
    origin[0] + deg(xy[1] / R),
    origin[1] + deg(xy[0] / (R * Math.cos(rad(origin[0])))),
  ]
}

/** 線段 a→b 上最接近 p 的位置；回傳 t（0–1）、該點、與 p 的距離 */
export function projectToSegment(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { t: number; point: LatLon; distM: number } {
  const [bx, by] = toLocalXY(a, b)
  const [px, py] = toLocalXY(a, p)
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  const cx = bx * t
  const cy = by * t
  return { t, point: fromLocalXY(a, [cx, cy]), distM: Math.hypot(px - cx, py - cy) }
}

/** 兩點之間依 t（0–1）內插 */
export function lerpLatLon(a: LatLon, b: LatLon, t: number): LatLon {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
