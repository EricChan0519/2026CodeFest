/**
 * deviceorientation 的 alpha/beta/gamma 轉成朝向。
 * Android（deviceorientationabsolute）的計算；iOS 直接用 webkitCompassHeading，不經過這裡。
 * 見 docs/arrow-nav/04-nav-logic.md#朝向。
 */
import { angleDiff, deg, norm360, rad } from '@/nav/geo'

/** |beta| 小於此值：純用手機上緣 */
const TOP_ONLY_BELOW = 50
/** |beta| 大於此值：純用手機背面。兩者之間線性過渡，避免在切換點朝向瞬間跳動 */
const BACK_ONLY_ABOVE = 70

/**
 * 手機「上緣」（接近直立時改用「背面」）朝向，**相對磁北**，順時針 0–360。
 * - |beta| < 50：平放到斜拿，用手機上緣
 * - |beta| > 70：接近直立，用手機背面（拿著手機看路時）
 * - 之間：兩者沿最短弧線混合（原本在 60° 硬切換，手拿在那附近時箭頭會突然跳）
 */
export function headingFromOrientation(alpha: number, beta: number, gamma: number): number {
  const top = norm360(360 - alpha)
  const ab = Math.abs(beta)
  if (ab <= TOP_ONLY_BELOW) return top
  const a = rad(alpha)
  const b = rad(beta)
  const g = rad(gamma)
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  const back = norm360(deg(Math.atan2(x, y)))
  if (ab >= BACK_ONLY_ABOVE) return back
  const w = (ab - TOP_ONLY_BELOW) / (BACK_ONLY_ABOVE - TOP_ONLY_BELOW)
  return norm360(top + w * angleDiff(back, top))
}

/** 磁北朝向 → 真北朝向（臺北磁偏角約 −4.7°，放在 NAV_CONFIG） */
export function toTrueNorth(magDeg: number, declinationDeg: number): number {
  return norm360(magDeg + declinationDeg)
}
