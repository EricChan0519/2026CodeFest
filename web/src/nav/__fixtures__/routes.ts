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

/**
 * L 形路線（先左轉再右轉）：北走 60，左轉西走 60，右轉北走 60。
 * 轉角在 index 6（左）、12（右），終點 index 18。終點在起點的西北方，
 * 所以「指向終點」和「指向第一段」的箭頭差很多（約 27°）。
 */
export const LEFT_THEN_RIGHT: Shape = {
  geometry: densify([[0, 0], [0, 60], [-60, 60], [-60, 120]]),
  maneuvers: [
    { kind: 'depart', atIndex: 0, distanceToNextM: 60, street: null },
    { kind: 'left', atIndex: 6, distanceToNextM: 60, street: null },
    { kind: 'right', atIndex: 12, distanceToNextM: 60, street: null },
    { kind: 'arrive', atIndex: 18, distanceToNextM: 0, street: null },
  ] satisfies Maneuver[],
}
export const LR_FIRST_TURN = pt(0, 60)
export const LR_SECOND_TURN = pt(-60, 60)
export const LR_END = pt(-60, 120)

/**
 * 銳角左轉：北走 60，在轉角折回往 210°（南南西）走 60。
 * 第二段離第一段很近，GPS 稍微偏東時，投影會落在第一段（轉角前）。
 */
export const ACUTE_LEFT: Shape = {
  geometry: densify([[0, 0], [0, 60], acuteLeg2(60)]),
  maneuvers: [
    { kind: 'depart', atIndex: 0, distanceToNextM: 60, street: null },
    { kind: 'left', atIndex: 6, distanceToNextM: 60, street: null },
    { kind: 'arrive', atIndex: 12, distanceToNextM: 0, street: null },
  ] satisfies Maneuver[],
}
export const ACUTE_TURN_POINT = pt(0, 60)
/** 沿 ACUTE_LEFT 第二段走 m 公尺的點（東、北公尺） */
export function acuteLeg2(m: number): [number, number] {
  const h = (210 * Math.PI) / 180
  return [m * Math.sin(h), 60 + m * Math.cos(h)]
}
