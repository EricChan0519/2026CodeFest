/**
 * deviceorientation 的 alpha/beta/gamma 轉成朝向。
 * Android（deviceorientationabsolute）的計算；iOS 直接用 webkitCompassHeading，不經過這裡。
 * 見 docs/arrow-nav/04-nav-logic.md#朝向。
 */
import { deg, norm360, rad } from '@/nav/geo'

/**
 * 手機「上緣」（接近直立時改用「背面」）朝向，**相對磁北**，順時針 0–360。
 * - |beta| < 60：平放到斜拿，用手機上緣
 * - 其餘：接近直立，用手機背面（拿著手機看路時）
 */
export function headingFromOrientation(alpha: number, beta: number, gamma: number): number {
  if (Math.abs(beta) < 60) return norm360(360 - alpha)
  const a = rad(alpha)
  const b = rad(beta)
  const g = rad(gamma)
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  return norm360(deg(Math.atan2(x, y)))
}

/** 磁北朝向 → 真北朝向（臺北磁偏角約 −4.7°，放在 NAV_CONFIG） */
export function toTrueNorth(magDeg: number, declinationDeg: number): number {
  return norm360(magDeg + declinationDeg)
}
