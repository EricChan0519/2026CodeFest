/**
 * 找目的地與「怎麼去」：邏輯搬自 views/lab/NavLab.vue，給主畫面用。
 * - 搜尋：同時查站牌（TDX 快照）、連鎖店（Overture 快照）、地標（後端 Overture 快照）和地址（OSM）；任何一邊失敗不影響其他。
 * - 排序：一律用「現在」的位置（lib/locator.ts）；等不到位置先用臺北車站，位置回來再重排。
 * - 搭公車：選了地點之後在裝置上算直達或轉一次車（lib/transferBus.ts），不划算的不列。
 * 錯誤用代碼回傳，文字由畫面依語言決定。
 */
import { ref, shallowRef } from 'vue'
import type { Audience, LatLon, Station } from '@/lib/contract'
import { searchPlaces } from '@/lib/geocode'
import type { Place } from '@/lib/geocode'
import type { Locator } from '@/lib/locator'
import { fromOsm, mergePlaces, searchLandmarks } from '@/lib/placeSearch'
import type { PlaceHit } from '@/lib/placeSearch'
import { loadPoiIndex, searchPois } from '@/lib/poiSearch'
import type { PoiHit, PoiIndex } from '@/lib/poiSearch'
import { loadStopIndex, searchStops } from '@/lib/stopSearch'
import type { StopIndex } from '@/lib/stopSearch'
import { planBus, WALK_M_PER_MIN } from '@/lib/transferBus'
import type { BusPlan } from '@/lib/transferBus'
import { loadMetroIndex } from '@/lib/metroIndex'
import { planTransit } from '@/lib/transitPlan'
import type { PlanTab, TransitPlan } from '@/lib/transitPlan'
import { distanceM } from '@/nav/geo'

export const TAIPEI_STATION: LatLon = [25.0478, 121.517]
/** 搜尋時最多等位置這麼久；等不到先用臺北車站排序、立刻顯示，位置回來再重排 */
const SEARCH_LOCATE_WAIT_MS = 2500
const POI_LIMIT = 100
const STOP_LIMIT = 20

export type SearchErrorCode = 'stops' | 'pois' | 'places' | 'landmarks'

export type BusNote = 'no_position' | 'old_index' | 'not_worth' | 'failed' | null

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

export function useDestinationSearch(locator: Locator) {
  const searching = ref(false)
  const places = shallowRef<PlaceHit[]>([])
  const pois = shallowRef<PoiHit[]>([])
  const stops = shallowRef<Station[]>([])
  /** 搜尋過了（區分「還沒搜尋」和「沒有結果」） */
  const searched = ref(false)
  const errors = ref<SearchErrorCode[]>([])
  /** 結果是依使用者位置排的（否則是臺北車站） */
  const nearUser = ref(false)
  const near = shallowRef<LatLon>(TAIPEI_STATION)
  const stopsUpdatedAt = ref('')
  const poiRelease = ref('')

  let seq = 0
  let last: { q: string; osm: Place[]; stops: StopIndex | null; pois: PoiIndex | null } | null = null

  /** 依參考點排序三種結果。地標要重查後端，因為「最近的 20 筆」會跟著位置變 */
  async function rank(mySeq: number, at: LatLon, isUser: boolean): Promise<boolean> {
    const l = last
    if (!l) return true
    let landmarks: PlaceHit[] = []
    let landOk = true
    try {
      landmarks = await searchLandmarks(l.q, at)
    } catch {
      landOk = false
    }
    if (mySeq !== seq) return landOk
    stops.value = l.stops ? searchStops(l.stops, l.q, STOP_LIMIT, at) : []
    pois.value = l.pois ? searchPois(l.pois, l.q, { near: at, limit: POI_LIMIT }) : []
    places.value = mergePlaces(l.q, [landmarks, l.osm.map(fromOsm)], at)
    nearUser.value = isUser
    near.value = at
    return landOk
  }

  async function search(raw: string) {
    const q = raw.trim()
    if (!q) return
    const mySeq = ++seq
    searching.value = true
    errors.value = []
    const later = locator.current()
    const loads = Promise.allSettled([loadStopIndex(), loadPoiIndex(), searchPlaces(q)])
    const user = await withTimeout(locator.current(), SEARCH_LOCATE_WAIT_MS)
    const [s, p, o] = await loads
    if (mySeq !== seq) return
    if (s.status === 'fulfilled') stopsUpdatedAt.value = s.value.updatedAt
    if (p.status === 'fulfilled') poiRelease.value = p.value.release
    last = {
      q,
      osm: o.status === 'fulfilled' ? o.value : [],
      stops: s.status === 'fulfilled' ? s.value : null,
      pois: p.status === 'fulfilled' ? p.value : null,
    }
    const landOk = await rank(mySeq, user ?? TAIPEI_STATION, !!user)
    if (mySeq !== seq) return
    const errs: SearchErrorCode[] = []
    if (s.status === 'rejected') errs.push('stops')
    if (p.status === 'rejected') errs.push('pois')
    if (o.status === 'rejected') errs.push('places')
    if (!landOk) errs.push('landmarks')
    errors.value = errs
    searched.value = true
    searching.value = false

    // 還不知道你在哪：位置回來後用真正的位置重排
    if (!user) {
      const pos = await later
      if (pos && mySeq === seq) await rank(mySeq, pos, true)
    }
  }

  /** 用現在的位置重排目前的結果（導航結束回到搜尋畫面時） */
  async function rerank() {
    if (!last || searching.value) return
    const mySeq = seq
    const user = await locator.current()
    if (user && mySeq === seq && !searching.value) await rank(mySeq, user, true)
  }

  function clear() {
    seq++
    last = null
    searching.value = false
    searched.value = false
    errors.value = []
    places.value = []
    pois.value = []
    stops.value = []
  }

  // ── 怎麼去：選了地點 A 之後算公車 ─────────────────
  const busOptions = shallowRef<BusPlan[]>([])
  /** 公車＋捷運規劃的三個分頁；還沒算或算不出來時是 null */
  const transit = shallowRef<Record<PlanTab, TransitPlan[]> | null>(null)
  const debugTransitTime = ref<Date | null>(null)
  const debugOrigin = ref<LatLon | null>(null)
  const busLoading = ref(false)
  const busNote = ref<BusNote>(null)
  /** 直接走過去約幾分鐘（直線距離估算）；拿不到位置時是 null */
  const walkMin = ref<number | null>(null)
  let busSeq = 0

  async function planTo(target: LatLon, audience: Audience = 'visitor') {
    const mySeq = ++busSeq
    busOptions.value = []
    transit.value = null
    busNote.value = null
    walkMin.value = null
    busLoading.value = true
    try {
      const [idx, user, metro] = await Promise.all([loadStopIndex(), debugOrigin.value ? Promise.resolve(debugOrigin.value) : locator.current(), loadMetroIndex()])
      if (mySeq !== busSeq) return
      if (!user) {
        busNote.value = 'no_position'
        return
      }
      walkMin.value = Math.max(1, Math.round(distanceM(user, target) / WALK_M_PER_MIN))
      if (idx.patterns.length === 0) {
        busNote.value = 'old_index'
        return
      }
      busOptions.value = planBus(idx.stations, idx.patterns, user, target)
      transit.value = planTransit({ stations: idx.stations, patterns: idx.patterns }, metro, user, target, { audience, now: debugTransitTime.value ?? undefined })
      const anyRide = transit.value.mixed.some((p) => p.rides.length > 0)
      if (!anyRide) busNote.value = 'not_worth'
    } catch {
      if (mySeq === busSeq) busNote.value = 'failed'
    } finally {
      if (mySeq === busSeq) busLoading.value = false
    }
  }

  function clearBus() {
    busSeq++
    busOptions.value = []
    transit.value = null
    busNote.value = null
    busLoading.value = false
    walkMin.value = null
  }

  return {
    searching,
    searched,
    errors,
    places,
    pois,
    stops,
    nearUser,
    near,
    stopsUpdatedAt,
    poiRelease,
    search,
    rerank,
    clear,
    busOptions,
    transit,
    debugTransitTime,
    debugOrigin,
    busLoading,
    busNote,
    walkMin,
    planTo,
    clearBus,
  }
}

export type DestinationSearch = ReturnType<typeof useDestinationSearch>
