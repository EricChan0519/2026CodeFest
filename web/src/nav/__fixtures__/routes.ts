/**
 * 測試用路線。以 ORIGIN 為原點，用公尺（東、北）描述，轉成 [lat, lon]。
 */
import type { LatLon, Maneuver, RouteOption } from '@/lib/contract'
import { fromLocalXY, toLocalXY } from '../geo'

export const ORIGIN: LatLon = [25.1155, 121.53]

/** 東 e 公尺、北 n 公尺的點 */
export const pt = (e: number, n: number): LatLon => fromLocalXY(ORIGIN, [e, n])
export const xy = (p: LatLon): [number, number] => toLocalXY(ORIGIN, p)

/** 沿著折線每隔 stepM 取一個點（含轉角點） */
export function densify(corners: [number, number][], stepM = 10): LatLon[] {
  const out: LatLon[] = [pt(...corners[0]!)]
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1]!
    const [x1, y1] = corners[i]!
    const len = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(1, Math.round(len / stepM))
    for (let k = 1; k <= n; k++) out.push(pt(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n))
  }
  return out
}

type Shape = Pick<RouteOption, 'geometry' | 'maneuvers'>

/** 北走 100 公尺，右轉，東走 100 公尺。轉角在 index 10，終點 index 20。 */
export const L_SHAPE: Shape = {
  geometry: densify([[0, 0], [0, 100], [100, 100]]),
  maneuvers: [
    { kind: 'depart', atIndex: 0, distanceToNextM: 100, street: null },
    { kind: 'right', atIndex: 10, distanceToNextM: 100, street: null },
    { kind: 'arrive', atIndex: 20, distanceToNextM: 0, street: null },
  ] satisfies Maneuver[],
}
export const L_TURN_POINT = pt(0, 100)
export const L_END = pt(100, 100)

/** 北走 150 公尺，繞到東邊 4 公尺，再南走回來。第二段和第一段只差 4 公尺。 */
export const HAIRPIN: Shape = {
  geometry: densify([[0, 0], [0, 150], [4, 150], [4, 0]]),
  maneuvers: [
    { kind: 'depart', atIndex: 0, distanceToNextM: 0, street: null },
    { kind: 'arrive', atIndex: 31, distanceToNextM: 0, street: null },
  ],
}

/** 起點就是終點，只有一個點 */
export const SINGLE_POINT: Shape = {
  geometry: [pt(0, 0)],
  maneuvers: [{ kind: 'arrive', atIndex: 0, distanceToNextM: 0, street: null }],
}

/** 直線往北 200 公尺，沒有轉彎 */
export const STRAIGHT: Shape = {
  geometry: densify([[0, 0], [0, 200]]),
  maneuvers: [
    { kind: 'depart', atIndex: 0, distanceToNextM: 200, street: null },
    { kind: 'arrive', atIndex: 20, distanceToNextM: 0, street: null },
  ],
}
