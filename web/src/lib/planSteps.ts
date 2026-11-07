/**
 * 把一個搭車方案拆成一步一步（路線方框裡條列顯示）：
 * 走到上車站 → 搭車坐幾站到哪裡 → （轉乘：走到下一個上車站）→ 搭車 → 走到目的地。
 * 走路的距離是直線距離乘上繞路係數的估計值；站內轉乘（距離很短）不列走路那一步。
 */
import type { LatLon } from './contract'
import type { Ride } from '@/nav/journey'
import { distanceM } from '@/nav/geo'
import { DETOUR } from './transitPlan'

/** 比這個短的走路（站內轉乘、下車就到）不列 */
export const MIN_WALK_STEP_M = 40

export type PlanStep =
  /** to：走到下一個要搭的車（ride）或目的地 */
  | { kind: 'walk'; m: number; to: 'board'; ride: Ride }
  | { kind: 'walk'; m: number; to: 'dest' }
  /** n：坐幾站 */
  | { kind: 'ride'; ride: Ride; n: number }

const boardAt = (r: Ride): LatLon => r.boardPoint ?? [r.board.lat, r.board.lon]
const alightAt = (r: Ride): LatLon => r.alightPoint ?? [r.alight.lat, r.alight.lon]

export function planSteps(rides: Ride[], from: LatLon, to: LatLon): PlanStep[] {
  const out: PlanStep[] = []
  let at = from
  rides.forEach((r) => {
    const m = Math.round(distanceM(at, boardAt(r)) * DETOUR)
    if (m >= MIN_WALK_STEP_M) out.push({ kind: 'walk', m, to: 'board', ride: r })
    out.push({ kind: 'ride', ride: r, n: Math.max(1, r.stops.length - 1) })
    at = alightAt(r)
  })
  const m = Math.round(distanceM(at, to) * DETOUR)
  if (m >= MIN_WALK_STEP_M) out.push({ kind: 'walk', m, to: 'dest' })
  return out
}
