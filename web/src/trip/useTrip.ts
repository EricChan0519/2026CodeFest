/**
 * 一整趟行程：走到上車站 → 上車 → 坐車 → 下車 →（轉乘）→ 走到目的地，走到目的地才結束。
 * 每一段走路交給 useNavSession，這裡只用 nav/journey.ts 決定下一段要走去哪。
 * 邏輯搬自 views/lab/NavLab.vue 的 startTrip／onWalkArrived／onBoarded／onGotOff／finishTrip。
 */
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ArrivalTrip } from '@/arrival/arrival'
import type { LatLon, Station, StationRoute } from '@/lib/contract'
import type { Locator } from '@/lib/locator'
import type { BusPlan } from '@/lib/transferBus'
import type { TransitPlan } from '@/lib/transitPlan'
import type { Cue } from '@/nav/announcer'
import { destinationFromPlace, destinationFromStation } from '@/nav/destination'
import { boarded, currentRide, gotOff, legArrived, rideStatus, rideStatusByTime, startJourney, walkTarget } from '@/nav/journey'
import type { Journey, Ride, RideStatus } from '@/nav/journey'
import { useNavSession } from './useNavSession'

/** 使用者最後選的走法 */
export type TripChoice =
  | { kind: 'walk'; name: string; point: LatLon }
  | { kind: 'bus'; plan: BusPlan; name: string; point: LatLon }
  /** 公車＋捷運規劃（lib/transitPlan.ts）選的一個方案 */
  | { kind: 'transit'; plan: TransitPlan; name: string; point: LatLon }
  /** 只選了站牌和那班車：走到站牌顯示到站畫面就結束 */
  | { kind: 'stop'; station: Station; route: StationRoute }

/** 畫面要蓋哪一張卡：到站（等車）、坐車中、只到站牌就結束 */
export type TripCard = 'at_stop' | 'ride' | 'stop_only' | null

export function useTrip(opts: { locator: Locator; onCue?: (c: Cue) => void }) {
  const journey = shallowRef<Journey | null>(null)
  const stopOnly = shallowRef<{ station: Station; route: StationRoute } | null>(null)
  const stopOnlyArrived = ref(false)
  /** 走到最後的目的地了（不是公車站） */
  const finalArrived = ref(false)
  const rideNow = ref<RideStatus>({ index: 0, remaining: 0, cue: 'none' })
  let rideWatchId: number | null = null
  /** 坐捷運：每秒用「上車後經過的秒數」推算到第幾站（地下收不到 GPS） */
  let rideTimer: ReturnType<typeof setInterval> | null = null
  let rideStartMs = 0

  const nav = useNavSession({ locator: opts.locator, onArrived, onCue: opts.onCue })

  function rideTrip(r: Ride, changeLine = false): ArrivalTrip {
    return {
      station: r.board.name,
      route: r.route.routeName,
      headsign: r.route.headsign,
      alight: r.alight.name,
      mode: r.mode,
      lineColor: r.lineColor,
      changeLine,
      exit: r.alightExit,
    }
  }
  /** 現在這張到站卡是捷運站內換線（上一段也是捷運） */
  const changingLine = computed(() => {
    const j = journey.value
    if (!j || j.phase !== 'at_stop' || j.rideIndex === 0) return false
    return j.rides[j.rideIndex - 1].mode === 'metro' && j.rides[j.rideIndex].mode === 'metro'
  })

  const ride = computed(() => (journey.value ? currentRide(journey.value) : null))
  const card = computed<TripCard>(() => {
    const p = journey.value?.phase
    if (p === 'at_stop' && ride.value) return 'at_stop'
    if (p === 'ride' && ride.value) return 'ride'
    if (stopOnlyArrived.value && stopOnly.value) return 'stop_only'
    return null
  })
  const cardTrip = computed<ArrivalTrip | null>(() => {
    if ((card.value === 'at_stop' || card.value === 'ride') && ride.value) return rideTrip(ride.value, changingLine.value)
    const s = stopOnly.value
    if (card.value === 'stop_only' && s) return { station: s.station.name, route: s.route.routeName, headsign: s.route.headsign }
    return null
  })
  /** 最後的目的地名稱 */
  const finalName = computed(() => journey.value?.final.name ?? stopOnly.value?.station.name.zh ?? '')
  /** 這一段走路是去公車站（畫面顯示路線） */
  const walkingToStop = computed(() => !!nav.active.value?.station)

  function start(choice: TripChoice) {
    stopRideWatch()
    finalArrived.value = false
    stopOnlyArrived.value = false
    stopOnly.value = null
    if (choice.kind === 'stop') {
      journey.value = null
      stopOnly.value = { station: choice.station, route: choice.route }
      void nav.begin(destinationFromStation(choice.station, choice.route))
      return
    }
    const rides = choice.kind === 'bus' || choice.kind === 'transit' ? choice.plan.rides : []
    journey.value = startJourney(rides, { name: choice.name, point: choice.point })
    const target = walkTarget(journey.value) ?? destinationFromPlace({ name: choice.name, point: choice.point })
    void nav.begin(target)
  }

  /** 這段走到了：行程往下一步 */
  function onArrived() {
    const j = journey.value
    if (j) {
      journey.value = legArrived(j)
      if (journey.value.phase === 'arrived') finalArrived.value = true
    } else {
      stopOnlyArrived.value = true
    }
  }

  function onBoarded() {
    const j = journey.value
    if (!j) return
    journey.value = boarded(j)
    const r = currentRide(journey.value)!
    if (r.mode === 'metro' && r.stopTimesS) {
      const times = r.stopTimesS
      rideStartMs = Date.now()
      rideNow.value = rideStatusByTime(times, 0)
      rideTimer = setInterval(() => {
        rideNow.value = rideStatusByTime(times, (Date.now() - rideStartMs) / 1000, rideNow.value.index)
      }, 1000)
      return
    }
    rideNow.value = rideStatus(r.stops, [r.board.lat, r.board.lon], 0)
    if (nav.simGps.value || !('geolocation' in navigator)) return
    rideWatchId = navigator.geolocation.watchPosition(
      (p) => {
        opts.locator.feed([p.coords.latitude, p.coords.longitude], p.coords.accuracy)
        const cur = journey.value && currentRide(journey.value)
        if (cur) rideNow.value = rideStatus(cur.stops, [p.coords.latitude, p.coords.longitude], rideNow.value.index)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
  }

  /** 模擬：公車開到下一站 */
  function simNextStop() {
    const r = ride.value
    if (!r) return
    if (r.mode === 'metro' && r.stopTimesS) {
      // 把上車時間往前挪，讓經過的秒數剛好到下一站
      const nextIdx = Math.min(rideNow.value.index + 1, r.stopTimesS.length - 1)
      rideStartMs = Date.now() - r.stopTimesS[nextIdx] * 1000
      rideNow.value = rideStatusByTime(r.stopTimesS, r.stopTimesS[nextIdx], rideNow.value.index)
      return
    }
    const next = r.stops[Math.min(rideNow.value.index + 1, r.stops.length - 1)]!
    rideNow.value = rideStatus(r.stops, [next.lat, next.lon], rideNow.value.index)
  }

  /** 下車了：走去下一個上車站（轉乘）或目的地，模擬 GPS 從下車站出發 */
  function onGotOff() {
    const j = journey.value
    const r = j && currentRide(j)
    if (!j || !r) return
    stopRideWatch()
    journey.value = gotOff(j)
    const target = walkTarget(journey.value)
    // 捷運從出站口開始走；站內換線沒有 target（直接進到站卡）
    if (target) void nav.begin(target, r.alightPoint ?? [r.alight.lat, r.alight.lon])
  }

  function stopRideWatch() {
    if (rideWatchId !== null) navigator.geolocation.clearWatch(rideWatchId)
    rideWatchId = null
    if (rideTimer !== null) clearInterval(rideTimer)
    rideTimer = null
  }

  /** 結束（中途按 ✕ 或到了按完成） */
  function end() {
    stopRideWatch()
    nav.stop()
    journey.value = null
    stopOnly.value = null
    stopOnlyArrived.value = false
    finalArrived.value = false
  }

  onBeforeUnmount(stopRideWatch)

  return {
    nav,
    journey,
    card,
    cardTrip,
    rideNow,
    finalArrived,
    finalName,
    walkingToStop,
    start,
    onBoarded,
    onGotOff,
    simNextStop,
    end,
  }
}

export type Trip = ReturnType<typeof useTrip>
