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
import type { Cue } from '@/nav/announcer'
import { destinationFromPlace, destinationFromStation } from '@/nav/destination'
import { boarded, currentRide, gotOff, legArrived, rideStatus, startJourney, walkTarget } from '@/nav/journey'
import type { Journey, Ride, RideStatus } from '@/nav/journey'
import { useNavSession } from './useNavSession'

/** 使用者最後選的走法 */
export type TripChoice =
  | { kind: 'walk'; name: string; point: LatLon }
  | { kind: 'bus'; plan: BusPlan; name: string; point: LatLon }
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

  const nav = useNavSession({ locator: opts.locator, onArrived, onCue: opts.onCue })

  function rideTrip(r: Ride): ArrivalTrip {
    return { station: r.board.name, route: r.route.routeName, headsign: r.route.headsign, alight: r.alight.name }
  }

  const ride = computed(() => (journey.value ? currentRide(journey.value) : null))
  const card = computed<TripCard>(() => {
    const p = journey.value?.phase
    if (p === 'at_stop' && ride.value) return 'at_stop'
    if (p === 'ride' && ride.value) return 'ride'
    if (stopOnlyArrived.value && stopOnly.value) return 'stop_only'
    return null
  })
  const cardTrip = computed<ArrivalTrip | null>(() => {
    if ((card.value === 'at_stop' || card.value === 'ride') && ride.value) return rideTrip(ride.value)
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
    journey.value = startJourney(choice.kind === 'bus' ? choice.plan.rides : [], { name: choice.name, point: choice.point })
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
    if (target) void nav.begin(target, [r.alight.lat, r.alight.lon])
  }

  function stopRideWatch() {
    if (rideWatchId !== null) navigator.geolocation.clearWatch(rideWatchId)
    rideWatchId = null
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
