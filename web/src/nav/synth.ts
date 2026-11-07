/**
 * 合成路線，只給 /lab 實驗頁和 ?demo=1 用，不代表真實步行路線。
 * 真實路線一律來自 POST /api/routes。
 */
import type { LatLon, Maneuver, RouteOption } from '@/lib/contract'
import { deg, distanceM, fromLocalXY, rad } from './geo'

/** 模擬行走的起點（天母附近），只用於室內模擬 */
export const ORIGIN_TAIPEI: LatLon = [25.1155, 121.53]

export type SynthRoute = Pick<RouteOption, 'geometry' | 'maneuvers'> & { id: string }

/** 沿折線每隔 stepM 取一個點（含轉角） */
function densify(corners: LatLon[], stepM = 10): LatLon[] {
  const out: LatLon[] = [corners[0]!]
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]!
    const b = corners[i]!
    const n = Math.max(1, Math.round(distanceM(a, b) / stepM))
    for (let k = 1; k <= n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
  }
  return out
}

/** 從 origin 沿 headingDeg（真北，順時針）走 meters 公尺的點 */
export function offsetPoint(origin: LatLon, headingDeg: number, meters: number): LatLon {
  const h = rad(headingDeg)
  return fromLocalXY(origin, [Math.sin(h) * meters, Math.cos(h) * meters])
}

/** 往 headingDeg 走 leg1M，轉彎（預設右轉），再走 leg2M。轉彎點是 index leg1M/10。 */
export function twoLegRoute(
  origin: LatLon,
  headingDeg: number,
  opts: { leg1M?: number; leg2M?: number; turn?: 'left' | 'right' } = {},
): SynthRoute {
  const { leg1M = 80, leg2M = 60, turn = 'right' } = opts
  const corner = offsetPoint(origin, headingDeg, leg1M)
  const h2 = headingDeg + (turn === 'right' ? 90 : -90)
  const end = offsetPoint(corner, h2, leg2M)
  const geometry = densify([origin, corner, end])
  const cornerIdx = Math.round(leg1M / 10)
  const maneuvers: Maneuver[] = [
    { kind: 'depart', atIndex: 0, distanceToNextM: leg1M, street: null },
    { kind: turn, atIndex: cornerIdx, distanceToNextM: leg2M, street: null },
    { kind: 'arrive', atIndex: geometry.length - 1, distanceToNextM: 0, street: null },
  ]
  return { id: 'synthetic', geometry, maneuvers }
}

/** 從 from 直線走到 to，模擬「重新規劃」的結果 */
export function straightRoute(from: LatLon, to: LatLon): SynthRoute {
  const geometry = densify([from, to])
  return {
    id: 'synthetic',
    geometry,
    maneuvers: [
      { kind: 'depart', atIndex: 0, distanceToNextM: distanceM(from, to), street: null },
      { kind: 'arrive', atIndex: geometry.length - 1, distanceToNextM: 0, street: null },
    ],
  }
}

/** 兩點之間的方位角，給 twoLegRoute 朝向預設用 */
export const bearingBetween = (a: LatLon, b: LatLon): number => {
  const dy = b[0] - a[0]
  const dx = (b[1] - a[1]) * Math.cos(rad(a[0]))
  return (deg(Math.atan2(dx, dy)) + 360) % 360
}
