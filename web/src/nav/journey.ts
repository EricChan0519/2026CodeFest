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

export type RideMode = 'bus' | 'metro'

/**
 * 一段車：公車或捷運。捷運站轉成同樣的 Station 形狀（stationUid 是 metro:BL12），到站卡、坐車卡共用。
 * 格式見 docs/arrow-nav/03-contracts.md「公車＋捷運規劃」。
 */
export interface Ride {
  mode: RideMode
  board: Station
  route: StationRoute
  alight: Station
  /** 上車站到下車站沿途每一站（含頭尾） */
  stops: Station[]
  /** 捷運才有：路線代表色 #RRGGBB */
  lineColor?: string
  /** 捷運才有：從上車站起算到 stops[i] 的累計秒數，stopTimesS[0] = 0 */
  stopTimesS?: number[]
  /** 走路段的目標（捷運是出口座標）；沒有時用 board 的座標 */
  boardPoint?: LatLon
  /** 捷運進站出口名稱，例如 "M3" */
  boardExit?: string
  /** 下車後步行的起點（捷運是出口座標）；沒有時用 alight 的座標 */
  alightPoint?: LatLon
  /** 捷運出站出口名稱 */
  alightExit?: string
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
    const d = { ...destinationFromStation(r.board, r.route), alight: r.alight }
    // 捷運帶到最近的出入口，不是車站中心點
    if (!r.boardPoint) return d
    return { ...d, name: r.boardExit ? `${d.name} ${r.boardExit}` : d.name, points: [r.boardPoint] }
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

/**
 * 使用者按「下車了」：還有下一段車就走去下一個上車站，不然走去目的地。
 * 捷運接捷運一定是站內換線（規劃器只在 transfers 之間轉），不用走到地面，直接進到站畫面。
 */
export function gotOff(j: Journey): Journey {
  if (j.phase !== 'ride') return j
  const next = j.rideIndex + 1
  if (next >= j.rides.length) return { ...j, phase: 'walk_to_dest' }
  const inStation = j.rides[j.rideIndex].mode === 'metro' && j.rides[next].mode === 'metro'
  return { ...j, rideIndex: next, phase: inStation ? 'at_stop' : 'walk_to_stop' }
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

/**
 * 坐捷運時用「上車後經過幾秒」推算到第幾站：地下常常收不到 GPS。
 * stopTimesS 是每站的累計秒數（Ride.stopTimesS）。離開倒數第二站就提醒「下一站下車」，
 * 到了預估的下車時間就提醒「請下車」；一樣只往前不往後，最後由使用者按「下車了」確認。
 */
export function rideStatusByTime(stopTimesS: number[], elapsedS: number, prevIndex = 0): RideStatus {
  const last = stopTimesS.length - 1
  let index = Math.min(Math.max(prevIndex, 0), last)
  while (index < last && elapsedS >= stopTimesS[index + 1]) index++
  if (index === last) return { index, remaining: 0, cue: 'get_off' }
  const remaining = last - index
  const leftSecondToLast = remaining === 1 && elapsedS > stopTimesS[index]
  return { index, remaining, cue: leftSecondToLast ? 'next_stop' : 'none' }
}
