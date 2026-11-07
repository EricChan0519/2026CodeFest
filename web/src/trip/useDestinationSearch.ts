/**
 * 找目的地與「怎麼去」：邏輯搬自 views/lab/NavLab.vue，給主畫面用。
 * - 搜尋：同時查站牌（TDX 快照）、連鎖店（Overture 快照）、地標（後端 Overture 快照）和地址（OSM）；任何一邊失敗不影響其他。
 * - 排序：一律用「現在」的位置（lib/locator.ts）；等不到位置先用臺北車站，位置回來再重排。
 * - 搭公車：選了地點之後在裝置上算直達或轉一次車（lib/transferBus.ts），不划算的不列。
 * - 外語（2026-11-08：主畫面打「즈산역」查不到）：先由後端換成中文（즈산역 → 芝山站）再查；
 *   結果的名稱、類別、地址再換成使用者的語言（lib/foreignSearch.ts，規則＋開放資料，不用 AI）。
 * 錯誤用代碼回傳，文字由畫面依語言決定。
 */
import { ref, shallowRef } from 'vue'
import type { Audience, ForeignLang, Lang, LatLon, Station } from '@/lib/contract'
import { emptyLabels, isForeignQuery, localizeResults, poiNameForTranslation, translateForSearch } from '@/lib/foreignSearch'
import type { QueryTranslation, ResultLabels } from '@/lib/foreignSearch'
import { searchPlaces } from '@/lib/geocode'
import type { Place } from '@/lib/geocode'
import type { Locator } from '@/lib/locator'
import { fromOsm, mergePlaces, osmMatches, searchLandmarks } from '@/lib/placeSearch'
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

/**
 * @param uiLang 畫面現在的語言（選語言那一步選的）；結果的名稱會換成這個語言。
 *               選中文時，若搜尋字串是外語，就用搜尋字串的語言。
 */
export function useDestinationSearch(locator: Locator, uiLang: () => Lang = () => 'zh-TW') {
  const searching = ref(false)
  /** 外語搜尋：使用者打的字換成的中文（畫面顯示「즈산역 → 芝山站」）；中文搜尋是 null */
  const translation = shallowRef<QueryTranslation | null>(null)
  /** 結果在使用者語言的寫法（名稱、類別、地址） */
  const labels = shallowRef<ResultLabels>(emptyLabels())
  /** 結果要翻成的語言；null 是只顯示中文 */
  const displayLang = ref<ForeignLang | null>(null)
  const places = shallowRef<PlaceHit[]>([])
  const pois = shallowRef<PoiHit[]>([])
  const stops = shallowRef<Station[]>([])
  /** 搜尋過了（區分「還沒搜尋」和「沒有結果」） */
  const searched = ref(false)
  /** 目前結果是用哪個字串搜尋的（搜尋欄可能已經改了字） */
  const searchedQuery = ref('')
  const errors = ref<SearchErrorCode[]>([])
  /** 結果是依使用者位置排的（否則是臺北車站） */
  const nearUser = ref(false)
  const near = shallowRef<LatLon>(TAIPEI_STATION)
  const stopsUpdatedAt = ref('')
  const poiRelease = ref('')

  let seq = 0
  let last: {
    q: string
    /** 外語搜尋時的原文（英文也比對 TDX 英文站名、連鎖店英文品牌）；中文是 null */
    original: string | null
    osm: Place[]
    stops: StopIndex | null
    pois: PoiIndex | null
  } | null = null

  function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
    const seen = new Set<string>()
    return items.filter((t) => {
      const k = key(t)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  /** 把結果翻成使用者的語言；後端失敗就只顯示中文 */
  async function refreshLabels(mySeq: number) {
    const lang = displayLang.value
    if (!lang) {
      labels.value = emptyLabels()
      return
    }
    const result = await localizeResults(lang, {
      names: [
        ...places.value.map((p) => p.name),
        ...pois.value.map((p) => poiNameForTranslation(p.name, p.brand)),
        ...stops.value.map((s) => s.name.zh),
        // 主畫面把同名站位合併成一筆，名稱拿掉括號（捷運芝山站(福華) → 捷運芝山站）
        ...stops.value.map((s) => s.name.zh.replace(/\s*(?:\(.*?\)|（.*?）)\s*/g, '').trim()),
      ],
      addresses: [...places.value.map((p) => p.address ?? ''), ...pois.value.map((p) => p.address)],
      categories: places.value.map((p) => p.category ?? ''),
    })
    if (mySeq === seq) labels.value = result
  }

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
    const qs = [l.q, ...(l.original ? [l.original] : [])]
    const idx = l.stops
    const poiIdx = l.pois
    stops.value = idx ? uniqueBy(qs.flatMap((q) => searchStops(idx, q, STOP_LIMIT, at)), (s) => s.stationUid).slice(0, STOP_LIMIT) : []
    pois.value = poiIdx
      ? uniqueBy(qs.flatMap((q) => searchPois(poiIdx, q, { near: at, limit: POI_LIMIT })), (p) => `${p.name}|${p.point[0]}|${p.point[1]}`)
          .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
          .slice(0, POI_LIMIT)
      : []
    // OSM 會把「芝山捷運站」模糊配到別的捷運站：名稱裡沒有地名本身（芝山）的不要（同 NavLab）
    places.value = mergePlaces(l.q, [landmarks, l.osm.filter((p) => osmMatches(l.q, p)).map(fromOsm)], at)
    nearUser.value = isUser
    near.value = at
    searchedQuery.value = l.q
    void refreshLabels(mySeq)
    return landOk
  }

  async function search(raw: string) {
    const typed = raw.trim()
    if (!typed) return
    const mySeq = ++seq
    searching.value = true
    errors.value = []
    translation.value = null
    // 外語先換成中文再查（즈산역 → 芝山站）；後端沒開或翻不出來就照原字串查
    let q = typed
    let original: string | null = null
    let queryLang: ForeignLang | null = null
    if (isForeignQuery(typed)) {
      try {
        const tr = await translateForSearch(typed)
        if (mySeq !== seq) return
        translation.value = tr
        queryLang = tr.lang
        if (tr.to) {
          q = tr.to
          original = typed
        }
      } catch {
        // 照原字串查
      }
    }
    const ui = uiLang()
    displayLang.value = ui === 'zh-TW' ? queryLang : (ui as ForeignLang)
    const later = locator.current()
    const loads = Promise.allSettled([loadStopIndex(), loadPoiIndex(), searchPlaces(q)])
    const user = await withTimeout(locator.current(), SEARCH_LOCATE_WAIT_MS)
    const [s, p, o] = await loads
    if (mySeq !== seq) return
    if (s.status === 'fulfilled') stopsUpdatedAt.value = s.value.updatedAt
    if (p.status === 'fulfilled') poiRelease.value = p.value.release
    last = {
      q,
      original,
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

  /** 換語言之後，目前的結果重新翻一次 */
  function relabel() {
    const ui = uiLang()
    displayLang.value = ui === 'zh-TW' ? translation.value?.lang ?? null : (ui as ForeignLang)
    void refreshLabels(seq)
  }

  function clear() {
    seq++
    last = null
    translation.value = null
    labels.value = emptyLabels()
    searching.value = false
    searched.value = false
    searchedQuery.value = ''
    errors.value = []
    places.value = []
    pois.value = []
    stops.value = []
  }

  // ── 怎麼去：選了地點 A 之後算公車 ─────────────────
  const busOptions = shallowRef<BusPlan[]>([])
  /** 公車＋捷運規劃的三個分頁；還沒算或算不出來時是 null */
  const transit = shallowRef<Record<PlanTab, TransitPlan[]> | null>(null)
  /** 公車＋捷運規劃的出發點（使用者位置或 debug 位置） */
  const transitFrom = shallowRef<LatLon | null>(null)
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
      transitFrom.value = user
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
    searchedQuery,
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
    translation,
    labels,
    displayLang,
    relabel,
    busOptions,
    transit,
    transitFrom,
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
