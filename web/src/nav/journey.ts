/**
 * 一趟行程：走到上車站 → 等車、上車 → 坐車 → 下車 →（轉乘就再走到下一個上車站）→ 走到目的地。
 * 只有走到目的地才算結束；到公車站不是終點。
 *
 * 純函式狀態機：畫面（NavLab）收到「走到了」「上車了」「下車了」時呼叫對應函式，拿新的狀態。
 * 每一段走路仍由既有的導航機（machine.ts）負責，這裡只決定下一段要走去哪。
 */
import type { LatLon, Station, StationRoute } from '@/lib/contract'
import { distanceM } from './geo'
import { destinationFromPlace, destinationFromStation, type Destination } from './destination'

/** 一段公車：直達車規劃（DirectBusOption）就符合這個形狀 */
export interface Ride {
  board: Station
  route: StationRoute
  alight: Station
  /** 上車站到下車站沿途每一站（含頭尾） */
  stops: Station[]
}

export type JourneyPhase = 'walk_to_stop' | 'at_stop' | 'ride' | 'walk_to_dest' | 'arrived'

export interface Journey {
  rides: Ride[]
  final: { name: string; point: LatLon }
  /** 目前或下一段公車是第幾段 */
  rideIndex: number
  phase: JourneyPhase
}

export function startJourney(rides: Ride[], final: Journey['final']): Journey {
  return { rides, final, rideIndex: 0, phase: rides.length ? 'walk_to_stop' : 'walk_to_dest' }
}

export function currentRide(j: Journey): Ride | null {
  return j.rides[j.rideIndex] ?? null
}

/** 現在這段要走去哪；沒有要走的（等車、坐車、已到達）回傳 null */
export function walkTarget(j: Journey): Destination | null {
  if (j.phase === 'walk_to_stop') {
    const r = currentRide(j)!
    return { ...destinationFromStation(r.board, r.route), alight: r.alight }
  }
  if (j.phase === 'walk_to_dest') return destinationFromPlace(j.final)
  return null
}

/** 這段走路的導航判斷到了 */
export function legArrived(j: Journey): Journey {
  if (j.phase === 'walk_to_stop') return { ...j, phase: 'at_stop' }
  if (j.phase === 'walk_to_dest') return { ...j, phase: 'arrived' }
  return j
}

/** 使用者按「上車了」 */
export function boarded(j: Journey): Journey {
  return j.phase === 'at_stop' ? { ...j, phase: 'ride' } : j
}

/** 使用者按「下車了」：還有下一段公車就走去下一個上車站，不然走去目的地 */
export function gotOff(j: Journey): Journey {
  if (j.phase !== 'ride') return j
  const next = j.rideIndex + 1
  return next < j.rides.length ? { ...j, rideIndex: next, phase: 'walk_to_stop' } : { ...j, phase: 'walk_to_dest' }
}

/** 離下車站這麼近就提醒下車（公車停靠位置和站位座標會差幾十公尺） */
export const GET_OFF_RADIUS_M = 60

export interface RideStatus {
  /** 目前最接近沿途第幾站 */
  index: number
  /** 還要坐幾站 */
  remaining: number
  /** next_stop：下一站下車；get_off：到了，請下車 */
  cue: 'none' | 'next_stop' | 'get_off'
}

/**
 * 坐車時用定位判斷到第幾站。只會往前不會往後：GPS 在車上常飄，飄回前一站不能讓站數變多。
 * 最後一定由使用者按「下車了」確認，這裡只負責提醒。
 */
export function rideStatus(stops: Station[], here: LatLon, prevIndex: number): RideStatus {
  const last = stops.length - 1
  let index = Math.min(Math.max(prevIndex, 0), last)
  let best = Infinity
  for (let i = index; i <= last; i++) {
    const d = distanceM(here, [stops[i].lat, stops[i].lon])
    if (d < best) {
      best = d
      index = i
    }
  }
  if (distanceM(here, [stops[last].lat, stops[last].lon]) <= GET_OFF_RADIUS_M) return { index: last, remaining: 0, cue: 'get_off' }
  const remaining = last - index
  return { index, remaining, cue: remaining === 1 ? 'next_stop' : 'none' }
}
