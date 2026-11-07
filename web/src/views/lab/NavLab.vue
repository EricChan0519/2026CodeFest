<script setup lang="ts">
/**
 * 導航實驗頁（N6 雛形）：把 nav/ 引擎接到畫面上，手機上可以直接測。
 * 用真實定位，向 Valhalla 要「避開階梯、小巷」的步行路線，導到使用者自己輸入的目的地：
 * 輸入站名、地址、路名、地標（或「緯度, 經度」）→ 搜尋 → 選一個結果 → 開始走。
 * - 公車站牌：查 TDX 站位快照（有現行站名和每個站位的路線、方向），選一班車；走到會跳到 /arrived。
 * - 連鎖店：便利商店、速食、連鎖餐廳（Overture Maps 快照，離線比對、依距離排序）；到了只在這個畫面顯示「到了」。
 * - 地點與地址：地標、餐廳、學校查自己後端的 Overture Maps 快照（/api/landmarks/search），路名、地址查 OpenStreetMap（Nominatim），
 *   兩邊合併後依距離排序；到了只在這個畫面顯示「到了」。
 * 所有結果都用「現在」的位置排序、算公車（lib/locator.ts），不沿用第一次定位的位置。
 * 文字是實驗用的中文；正式文案走 i18n（UI 負責）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'

import { SPEECH_LANGS, tripFromQuery, type ArrivalTrip } from '@/arrival/arrival'
import { speakText } from '@/arrival/speech'
import LanguagePicker from '@/components/LanguagePicker.vue'
import { loadStoredLang, resolveLang, saveLang } from '@/i18n/lang'
import { NAV_STRINGS, type NavStrings } from '@/i18n/nav'
import { bigText as navBigText, busPlanText, cueText, fill, placeDistance, routeName, sentence as navSentence, stopName } from '@/nav/navText'
import ArrivalCard from '@/arrival/ArrivalCard.vue'
import RideCard from '@/arrival/RideCard.vue'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import {
  boarded,
  currentRide,
  gotOff,
  legArrived,
  rideStatus,
  startJourney,
  walkTarget,
  type Journey,
  type Ride,
  type RideStatus,
} from '@/nav/journey'
import type { Lang, LatLon, Station, StationRoute } from '@/lib/contract'
import { createAnnouncer } from '@/nav/announcer'
import { easeRotation } from '@/nav/arrow'
import { NAV_CONFIG } from '@/nav/config'
import type { Cue } from '@/nav/announcer'
import { createNavMachine } from '@/nav/machine'
import type { NavMachine, NavRoute, NavState, NavView, ResyncReason } from '@/nav/machine'
import {
  DEFAULT_DESTINATION,
  createDestinationLock,
  destinationFromBusOption,
  destinationFromPlace,
  destinationFromStation,
} from '@/nav/destination'
import type { Destination, DestinationLock } from '@/nav/destination'
import { searchPlaces } from '@/lib/geocode'
import type { Place } from '@/lib/geocode'
import { createLocator } from '@/lib/locator'
import { fromOsm, mergePlaces, osmMatches, searchLandmarks } from '@/lib/placeSearch'
import type { PlaceHit } from '@/lib/placeSearch'
import { loadPoiIndex, searchPois } from '@/lib/poiSearch'
import type { PoiHit, PoiIndex } from '@/lib/poiSearch'
import { planBus, type BusPlan } from '@/lib/transferBus'
import { loadStopIndex, searchStops } from '@/lib/stopSearch'
import { emptyLabels, isForeignQuery, localizeResults, poiNameForTranslation, stopLabel, translateForSearch } from '@/lib/foreignSearch'
import type { NameLabel, QueryTranslation, ResultLabels } from '@/lib/foreignSearch'
import type { ForeignLang } from '@/lib/contract'
import type { StopIndex } from '@/lib/stopSearch'
import { fetchWalkRoute } from '@/lib/walkRoute'
import type { WalkRoute } from '@/lib/walkRoute'
import { bearingDeg, distanceM } from '@/nav/geo'
import { createTraceRecorder } from '@/nav/trace'
import type { TraceRecorder } from '@/nav/trace'
import { ManualGpsSource } from '@/sensors/manual'
import type { PositionFix } from '@/sensors/source'
import type { SensorSource } from '@/sensors/source'
import { WakeLockHolder } from '@/sensors/wakelock'
import { WebSensorSource } from '@/sensors/web'
import NavDebugMap from './NavDebugMap.vue'
import Joystick from './Joystick.vue'
import type { JoystickVector } from '@/sensors/joystick'

/**
 * 語言：一開始先選（記在這支手機上），網址 ?lang= 優先。之後整頁都用這個語言；
 * 問問卡一律中文，給旁人看。除錯面板與模擬 GPS 控制是開發用，維持中文。
 */
const currentRoute = useRoute()
const chosenLang = ref<Lang | null>(resolveLang(currentRoute.query.lang, loadStoredLang()))
const pickingLang = ref(false)
const showLangPicker = computed(() => !chosenLang.value || pickingLang.value)
const L = computed<Lang>(() => chosenLang.value ?? 'zh-TW')
const t = computed(() => NAV_STRINGS[L.value])
function pickLang(l: Lang) {
  chosenLang.value = l
  saveLang(l)
  pickingLang.value = false
}

// 目的地：預設是示範站牌；搜尋後選一個結果就換成那個地點
const destination = shallowRef<Destination>(DEFAULT_DESTINATION)
const addressInput = ref('')
const searching = ref(false)
/** 搜尋的錯誤，存文字鍵，換語言時跟著換 */
const searchError = ref<keyof NavStrings | ''>('')
const stopResults = ref<Station[] | null>(null)
const placeResults = ref<PlaceHit[] | null>(null)
const poiResults = ref<PoiHit[] | null>(null)
const stopsUpdatedAt = ref('')
const poiRelease = ref('')
/** 外語搜尋：搜尋字串換成的中文（畫面上顯示「대만박물관 → 臺灣博物館」） */
const translation = ref<QueryTranslation | null>(null)
/** 中文介面時，從外語搜尋字串猜出來的語言（例如介面選中文、卻打韓文） */
const queryLang = ref<ForeignLang | null>(null)
/** 結果名稱要翻成的語言：選語言畫面選的語言；選中文時用搜尋字串的語言；都沒有是 null（只顯示中文） */
const displayLang = computed<ForeignLang | null>(() => (L.value === 'zh-TW' ? queryLang.value : (L.value as ForeignLang)))
/** 搜尋結果的名稱、地址、類別在使用者語言的寫法 */
const labels = shallowRef<ResultLabels>(emptyLabels())

interface NameLines {
  main: string
  /** 中文原名（招牌、站牌上看到的）；中文介面是 null */
  sub: string | null
  /** 名稱有一部分是用讀音寫的 */
  approx: boolean
}

/** 結果名稱的兩行：上面是使用者的語言，下面是中文原名 */
function linesOf(zh: string, l: NameLabel | null | undefined): NameLines {
  if (!l) return { main: zh, sub: null, approx: false }
  return { main: l.text, sub: zh, approx: l.approx }
}
function nameLines(zh: string): NameLines {
  return linesOf(zh, displayLang.value ? labels.value.names.get(zh) : null)
}
/** 連鎖店：品牌換成英文名後再翻（見 poiNameForTranslation），第二行留原本的中文店名 */
function poiLines(p: PoiHit): NameLines {
  const l = displayLang.value ? labels.value.names.get(poiNameForTranslation(p.name, p.brand)) : null
  return l ? { main: l.text, sub: p.name, approx: l.approx } : { main: p.name, sub: null, approx: false }
}
function stopLines(st: Station): NameLines {
  const lang = displayLang.value
  return linesOf(st.name.zh, lang ? stopLabel(st, lang, labels.value.names) : null)
}
/** 類別＋地址：使用者的語言（有翻的話），下面再附中文地址給路人、司機看 */
function detailLines(category: string | null, address: string | null, fallback: string): { main: string; sub: string | null } {
  if (!displayLang.value) return { main: fallback, sub: null }
  const cat = category ? labels.value.categories.get(category) ?? category : null
  const addr = address ? labels.value.addresses.get(address) ?? null : null
  const main = [cat, addr].filter(Boolean).join(' · ')
  if (!main) return { main: fallback, sub: null }
  return { main, sub: address && addr && addr !== address ? address : null }
}

/** 結果依距離排序用的參考點是不是使用者位置；拿不到位置就用臺北車站 */
const nearUser = ref(false)
const TAIPEI_STATION: LatLon = [25.0478, 121.517]

/**
 * 使用者「現在」的位置：頁面開著就持續更新，導航中的真實 GPS 也會餵進來（lib/locator.ts）。
 * 每次搜尋、選地點都重新取，不沿用第一次定位的位置（2026-11-07 回報：中斷導航後換地點，還在用舊位置算）。
 */
const locator = createLocator()
onMounted(() => locator.start())
onBeforeUnmount(() => locator.stop())
/** 搜尋時最多等位置這麼久；等不到先用臺北車站排序、立刻顯示，位置回來再重排 */
const SEARCH_LOCATE_WAIT_MS = 2500

function positionWithin(ms: number): Promise<LatLon | null> {
  return Promise.race([locator.current(), new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

let searchSeq = 0
/** 最近一次搜尋：位置變了（位置晚到、導航結束回來）時用來重排，不用再查一次 OpenStreetMap */
let lastSearch: {
  q: string
  /** 外語搜尋時使用者打的原文（英文也比對 TDX 英文站名、連鎖店英文品牌）；中文搜尋是 null */
  original: string | null
  osm: Place[]
  stops: StopIndex | null
  pois: PoiIndex | null
} | null = null

const BEARING_TEXT: Record<string, string> = {
  N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北',
}

/**
 * 依參考點排序三種結果。地標要重查後端，因為「最近的 20 筆」會跟著位置變。
 * @returns 地標查詢失敗的原因（沒失敗是 null）
 */
async function rankResults(seq: number, near: LatLon, isUser: boolean): Promise<string | null> {
  const last = lastSearch
  if (!last) return null
  let landmarks: PlaceHit[] = []
  let landError: string | null = null
  try {
    landmarks = await searchLandmarks(last.q, near)
  } catch (e) {
    landError = (e as Error).message
  }
  if (seq !== searchSeq) return null
  const qs = [last.q, ...(last.original ? [last.original] : [])]
  const stops = last.stops
  const pois = last.pois
  stopResults.value = stops ? uniqueBy(qs.flatMap((q) => searchStops(stops, q, 20, near)), (s) => s.stationUid).slice(0, 20) : []
  poiResults.value = pois
    ? uniqueBy(qs.flatMap((q) => searchPois(pois, q, { near, limit: POI_LIMIT })), (p) => `${p.name}|${p.point[0]}|${p.point[1]}`)
        .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
        .slice(0, POI_LIMIT)
    : []
  placeResults.value = mergePlaces(last.q, [landmarks, last.osm.filter((p) => osmMatches(last.q, p)).map(fromOsm)], near)
  nearUser.value = isUser
  poiShown.value = POI_PAGE
  placeShown.value = PLACE_PAGE
  void refreshLabels(seq)
  return landError
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((t) => {
    const k = key(t)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 把結果的名稱、地址、類別翻成使用者的語言；後端失敗就只顯示中文 */
async function refreshLabels(seq: number) {
  const lang = displayLang.value
  if (!lang) {
    labels.value = emptyLabels()
    return
  }
  const places = placeResults.value ?? []
  const pois = poiResults.value ?? []
  const result = await localizeResults(lang, {
    names: [
      ...places.map((p) => p.name),
      ...pois.map((p) => poiNameForTranslation(p.name, p.brand)),
      ...(stopResults.value ?? []).map((s) => s.name.zh),
    ],
    addresses: [...places.map((p) => p.address ?? ''), ...pois.map((p) => p.address)],
    categories: places.map((p) => p.category ?? ''),
  })
  if (seq === searchSeq) labels.value = result
}

/** 點「也可能是…」：用那個中文重新搜尋 */
function searchFor(text: string) {
  addressInput.value = text
  void search()
}

/** 用現在的位置重排目前的搜尋結果（導航結束回到搜尋畫面時） */
async function rerankWithCurrentPosition() {
  if (!lastSearch || searching.value) return
  const seq = searchSeq
  const user = await locator.current()
  if (user && seq === searchSeq && !searching.value) await rankResults(seq, user, true)
}

function hasAnyResult(): boolean {
  return !!(stopResults.value?.length || poiResults.value?.length || placeResults.value?.length)
}

/** 同時查站牌（TDX 快照）、連鎖店（Overture 快照）、地標（後端 Overture 快照）和地址（OSM）；任何一邊失敗不影響其他 */
async function search() {
  const raw = addressInput.value.trim()
  if (!raw || searching.value) return
  searching.value = true
  const seq = ++searchSeq
  searchError.value = ''
  translation.value = null
  // 外語：先換成中文再搜尋（後端規則翻譯，不用 AI）；後端沒開或翻不出來就照原字串搜尋
  let q = raw
  let original: string | null = null
  if (isForeignQuery(raw)) {
    try {
      const tr = await translateForSearch(raw)
      translation.value = tr
      queryLang.value = tr.lang
      if (tr.to) {
        q = tr.to
        original = raw
      }
    } catch {
      // 照原字串搜尋
    }
  } else {
    queryLang.value = null
  }
  clearBusPlan()
  stopResults.value = null
  placeResults.value = null
  poiResults.value = null
  const later = locator.current()
  const loads = Promise.allSettled([loadStopIndex(), loadPoiIndex(), searchPlaces(q)])
  const user = await positionWithin(SEARCH_LOCATE_WAIT_MS)
  const [stops, pois, places] = await loads
  if (stops.status === 'fulfilled') stopsUpdatedAt.value = stops.value.updatedAt
  if (pois.status === 'fulfilled') poiRelease.value = pois.value.release
  lastSearch = {
    q,
    original,
    osm: places.status === 'fulfilled' ? places.value : [],
    stops: stops.status === 'fulfilled' ? stops.value : null,
    pois: pois.status === 'fulfilled' ? pois.value : null,
  }
  const landError = await rankResults(seq, user ?? TAIPEI_STATION, !!user)
  const errors: string[] = []
  if (stops.status === 'rejected') errors.push(`站牌資料載入失敗（${(stops.reason as Error).message}）`)
  if (pois.status === 'rejected') errors.push(`連鎖店資料載入失敗（${(pois.reason as Error).message}）`)
  if (places.status === 'rejected') errors.push(`地址搜尋失敗（${(places.reason as Error).message}）`)
  if (landError) errors.push(`地標搜尋失敗（${landError}）`)
  if (errors.length) {
    log(`搜尋：${errors.join('；')}`)
    searchError.value = 'someFailed'
  } else if (!hasAnyResult()) {
    searchError.value = 'notFound'
  }
  searching.value = false

  // 還不知道你在哪：位置回來後用真正的位置重排（期間使用者可以先看以臺北車站排序的結果）
  if (!user) {
    const pos = await later
    if (pos && seq === searchSeq) await rankResults(seq, pos, true)
  }
}

/** 地點與地址：一次顯示 10 筆 */
const PLACE_PAGE = 10
const placeShown = ref(PLACE_PAGE)
const placeVisible = computed(() => (placeResults.value ?? []).slice(0, placeShown.value))

/** 連鎖店：一次顯示 10 家，按「再多看一些」展開；最多留 100 家 */
const POI_PAGE = 10
const POI_LIMIT = 100
const poiShown = ref(POI_PAGE)
const poiVisible = computed(() => (poiResults.value ?? []).slice(0, poiShown.value))

/**
 * 選了地址（或店家）A 之後：用使用者位置和 A 算可以直達的公車，列在「搭公車去」。
 * 選一班車 → 導航到上車站，到站時 /arrived 會顯示「在 ○○ 下車」。
 * 沒選車就維持步行直接到 A。整個計算在裝置上做，不呼叫外部服務。
 */
const busOptions = ref<BusPlan[] | null>(null)
const busLoading = ref(false)
const busNote = ref<keyof NavStrings | ''>('')
const pickedBus = shallowRef<BusPlan | null>(null)
const busTargetName = ref('')
const busTargetPoint = shallowRef<LatLon | null>(null)
let busSeq = 0
/** 選了地點 A 之後，搜尋結果收起來，「搭公車去」放在搜尋框正下方 */
const showBusPanel = computed(() => busLoading.value || !!busOptions.value || !!busNote.value)
const busPanel = ref<HTMLElement | null>(null)

/** 手機上點的地點常在畫面下半部：把「搭公車去」捲到畫面最上面，不然看起來像沒反應 */
function revealBusPanel() {
  // 搜尋結果收起來後頁面會變短，平滑捲動會跑過頭；等畫面更新完再直接跳到標題
  void nextTick(() => {
    const el = busPanel.value
    if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 16) })
  })
}

/** 不搭車：目的地改回地點 A，走路過去 */
function walkInstead() {
  if (!busTargetPoint.value) return
  pickedBus.value = null
  destination.value = destinationFromPlace({ name: busTargetName.value, point: busTargetPoint.value })
}

/** 回到搜尋結果，重選目的地 */
function reselectDestination() {
  clearBusPlan()
  destination.value = DEFAULT_DESTINATION
}

async function planBusTo(target: LatLon, name: string) {
  const seq = ++busSeq
  busTargetName.value = name
  busTargetPoint.value = target
  busOptions.value = null
  pickedBus.value = null
  busNote.value = ''
  busLoading.value = true
  try {
    // 每次都用現在的位置（不是第一次定位的位置）
    const [idx, user] = await Promise.all([loadStopIndex(), locator.current()])
    if (seq !== busSeq) return
    if (!user) {
      busNote.value = 'busNoLocation'
      return
    }
    if (idx.patterns.length === 0) {
      busNote.value = 'busOldData'
      return
    }
    busOptions.value = planBus(idx.stations, idx.patterns, user, target)
    if (busOptions.value.length === 0) busNote.value = 'busNone'
  } catch (e) {
    if (seq === busSeq) {
      log(`公車資料載入失敗：${(e as Error).message}`)
      busNote.value = 'busFailed'
    }
  } finally {
    if (seq === busSeq) {
      busLoading.value = false
      // 結果出來後這一區變高，瀏覽器的捲動錨點會把畫面往下推；再對齊一次標題
      revealBusPanel()
    }
  }
}

function clearBusPlan() {
  busSeq++
  busOptions.value = null
  pickedBus.value = null
  busNote.value = ''
  busLoading.value = false
}

function pickBus(o: BusPlan) {
  pickedBus.value = o
  destination.value = destinationFromBusOption(o.rides[0])
}

function isBusPicked(o: BusPlan): boolean {
  return pickedBus.value === o
}

function rideLabel(r: BusPlan['rides'][number]): string {
  return routeLabel(r.route)
}

function busLabel(o: BusPlan): string {
  return o.rides.map(rideLabel).join(' → ')
}

function busKey(o: BusPlan): string {
  return o.rides.map((r) => `${r.route.routeName.zh}-${r.route.direction}`).join('>')
}

const busIsTransfer = computed(() => (busOptions.value ?? []).some((o) => o.rides.length > 1))

function pickPoi(p: PoiHit) {
  destination.value = destinationFromPlace({ name: p.name, point: p.point })
  void planBusTo(p.point, p.name)
  revealBusPanel()
}

function isPoiPicked(p: PoiHit): boolean {
  const pt = destination.value.points[0]
  return !destination.value.station && !!pt && pt[0] === p.point[0] && pt[1] === p.point[1]
}

function pickPlace(p: Place) {
  destination.value = destinationFromPlace(p)
  void planBusTo(p.point, p.name)
  revealBusPanel()
}

/** 選站牌時一定要同時選一班車，到站才知道要念哪一線 */
function pickStopRoute(station: Station, route: StationRoute) {
  clearBusPlan()
  destination.value = destinationFromStation(station, route)
}

function isPlacePicked(p: Place | PlaceHit): boolean {
  const pt = destination.value.points[0]
  return !destination.value.station && !!pt && pt[0] === p.point[0] && pt[1] === p.point[1]
}

function isRoutePicked(station: Station, route: StationRoute): boolean {
  return destination.value.station?.stationUid === station.stationUid && destination.value.stationRoute?.stopUid === route.stopUid
}

/** 路線＋方向；非中文介面用英文路線名和方向（TDX 有英文） */
function routeLabel(r: StationRoute): string {
  const head = L.value === 'zh-TW' ? r.headsign.zh : r.headsign.en || r.headsign.zh
  return `${routeName(r.routeName, L.value)}${head ? ` ${head}` : ''}`
}

function useDemoStation() {
  clearBusPlan()
  destination.value = DEFAULT_DESTINATION
}

const routeInfo = ref<WalkRoute | null>(null)
const routeError = ref('')
const running = ref(false)
const view = ref<NavView | null>(null)
const cues = ref<string[]>([])
const manualHeading = ref(0)
const useManualHeading = ref(false)
const permissionNote = ref('')
const wakeNote = ref('')
const showDebug = ref(false)
/** 模擬 GPS：位置由方向鍵／點地圖決定，朝向仍用真實羅盤（或手動滑桿） */
const simGps = ref(false)
/**
 * 模擬 GPS 的搖桿「往上」是哪個方向：
 * - map（預設）：地圖的上方＝北。下面的除錯地圖是北朝上，往上推點就往上走，不會覺得反了
 * - phone：手機面對的方向（真的拿著手機轉身測箭頭時用）
 */
const joyFrame = ref<'map' | 'phone'>('map')
const joyForwardDeg = () => (joyFrame.value === 'map' ? 0 : (view.value?.headingDeg ?? 0))
/** 搖桿推到底時的速度（公尺／秒）；1.4 約等於步行 */
const simSpeed = ref(1.4)
/** 鍵盤方向鍵一次移動幾公尺 */
const KEY_STEP_M = 5
const simNote = ref('')
/** 重新規劃一律失敗，用來測 back_to_route */
const rerouteFails = ref(false)
const destinationPoint = ref<LatLon | null>(null)
/** 由連續定位算出的行進方向（真北），用來和羅盤比對 */
const gpsCourse = ref<number | null>(null)
const traceCount = ref(0)

/** 模擬 GPS 拿不到真實位置時的起點：這一趟目的地正南方約 400 公尺 */
function simFallbackStart(): LatLon {
  const [lat, lon] = active.points[0] ?? DEFAULT_DESTINATION.points[0]!
  return [lat - 0.0036, lon]
}

let machine: NavMachine | null = null
let source: SensorSource | null = null
let tickTimer: number | null = null
let manual: ManualGpsSource | null = null
let recorder: TraceRecorder | null = null
let courseFrom: LatLon | null = null
/** 這一趟實際導航的目的地（開始走時固定下來，之後改搜尋結果不影響） */
let active: Destination = DEFAULT_DESTINATION
/** 目的地站位一趟只選一次，重算不可以換到對面站牌 */
let destLock: DestinationLock = createDestinationLock(DEFAULT_DESTINATION)
/** 給畫面用的：這一趟的目的地名稱、是不是站牌（站牌才會說「在這裡等公車」） */
const activeName = ref('')
const activeIsStation = ref(false)
const activeRide = shallowRef<{ route: StationRoute; alight: Station | null } | null>(null)
const activeRoute = computed(() => {
  const r = activeRide.value
  if (!r) return ''
  const bus = fill(t.value.takeBus, { bus: routeLabel(r.route) })
  return r.alight ? `${bus}・${fill(ARRIVAL_STRINGS[L.value].getOffAt, { stop: stopName(r.alight.name, L.value) })}` : bus
})
let lastTickAt = 0
/** 每秒的計時器隔超過這麼久才回來，代表頁面被凍結過 */
const RESUME_GAP_MS = 3000
const RESYNC_TEXT: Record<ResyncReason, string> = {
  manual: '手動',
  resumed: '回到畫面',
  heading_silent: '羅盤沒有資料',
  heading_frozen: '羅盤數值卡住',
  course_mismatch: '羅盤與實際走向不符',
}
const wake = new WakeLockHolder()
const announcer = createAnnouncer()

const BG: Record<NavState, string> = {
  locating: '#30383D',
  routing: '#30383D',
  navigating: '#356C77',
  weak_signal: '#74521B',
  rerouting: '#74521B',
  back_to_route: '#74521B',
  arrived: '#27500A',
  failed: '#30383D',
}

const bigText = computed(() => (view.value ? navBigText(view.value, L.value) : ''))
const sentence = computed(() => (view.value ? navSentence(view.value, L.value, activeIsStation.value) : ''))

const showArrow = computed(() => {
  const v = view.value
  return !!v && v.arrowDeg !== null && v.state !== 'arrived'
})

function log(line: string) {
  cues.value = [`${new Date().toLocaleTimeString()} ${line}`, ...cues.value].slice(0, 12)
}

let arrivedHandled = false
/** 對象用 /lab/nav?audience=elder 指定，沒給就是 visitor；語言是使用者一開始選的 */
const langAudience = computed(() => ({ lang: L.value, audience: tripFromQuery(currentRoute.query).audience }))
/** 問問卡「我迷路了」要的最終目的地 */
const finalPlace = computed(() => (journey.value ? { zh: journey.value.final.name, en: null } : null))
const doneLabel = computed(() => ARRIVAL_STRINGS[langAudience.value.lang].done)
const boardedLabel = computed(() => ARRIVAL_STRINGS[langAudience.value.lang].boarded)

/**
 * 行程：走到上車站 → 上車 → 坐車 → 下車 →（轉乘）→ 走到目的地，走到目的地才結束。
 * 到站畫面、坐車畫面直接蓋在這一頁上，不跳頁，行程才不會中斷。
 * 只選了站牌和那班車（沒有最終目的地）時，走到站牌顯示到站畫面就結束。
 */
const journey = shallowRef<Journey | null>(null)
const stopOnlyArrived = ref(false)
const rideNow = ref<RideStatus>({ index: 0, remaining: 0, cue: 'none' })
let rideWatchId: number | null = null

function rideTrip(r: Ride): ArrivalTrip {
  return { station: r.board.name, route: r.route.routeName, headsign: r.route.headsign, alight: r.alight.name }
}
const atStopTrip = computed(() => {
  const r = journey.value && currentRide(journey.value)
  return r ? rideTrip(r) : null
})
const finalTrip = computed<ArrivalTrip | null>(() =>
  journey.value ? { station: { zh: journey.value.final.name, en: null }, route: { zh: '', en: null }, headsign: { zh: null, en: null } } : null,
)
const stopOnlyTrip = computed<ArrivalTrip | null>(() =>
  active.station && active.stationRoute
    ? { station: active.station.name, route: active.stationRoute.routeName, headsign: active.stationRoute.headsign, alight: active.alight?.name }
    : null,
)

/** 「開始走」：選了公車就建一趟完整行程；只選站牌就只走到站牌；一般地點就走到那裡 */
function startTrip() {
  stopOnlyArrived.value = false
  const d = destination.value
  if (pickedBus.value && busTargetPoint.value) {
    journey.value = startJourney(pickedBus.value.rides, { name: busTargetName.value, point: busTargetPoint.value })
  } else if (d.station) {
    journey.value = null
  } else {
    journey.value = startJourney([], { name: d.name, point: d.points[0] })
  }
  const target = journey.value && walkTarget(journey.value)
  if (target) destination.value = target
  void begin()
}

/** 這段走到了：行程往下一步，畫面換成到站卡或抵達卡 */
function onWalkArrived() {
  stopAll()
  if (journey.value) journey.value = legArrived(journey.value)
  else stopOnlyArrived.value = true
}

function onBoarded() {
  const j = journey.value
  if (!j) return
  journey.value = boarded(j)
  const r = currentRide(journey.value)!
  const start: LatLon = [r.board.lat, r.board.lon]
  rideNow.value = rideStatus(r.stops, start, 0)
  void wake.on()
  if (simGps.value || !('geolocation' in navigator)) return
  rideWatchId = navigator.geolocation.watchPosition(
    (p) => {
      locator.feed([p.coords.latitude, p.coords.longitude], p.coords.accuracy)
      const ride = journey.value && currentRide(journey.value)
      if (ride) rideNow.value = rideStatus(ride.stops, [p.coords.latitude, p.coords.longitude], rideNow.value.index)
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 },
  )
}

/** 模擬：公車開到下一站 */
function simNextStop() {
  const r = journey.value && currentRide(journey.value)
  if (!r) return
  const next = r.stops[Math.min(rideNow.value.index + 1, r.stops.length - 1)]
  rideNow.value = rideStatus(r.stops, [next.lat, next.lon], rideNow.value.index)
}

function stopRideWatch() {
  if (rideWatchId !== null) navigator.geolocation.clearWatch(rideWatchId)
  rideWatchId = null
}

/** 下車了：走去下一個上車站（轉乘）或目的地，模擬 GPS 從下車站出發 */
function onGotOff() {
  const j = journey.value
  const r = j && currentRide(j)
  if (!j || !r) return
  stopRideWatch()
  journey.value = gotOff(j)
  const target = walkTarget(journey.value)
  if (!target) return
  destination.value = target
  void begin([r.alight.lat, r.alight.lon])
}

/** 行程結束：回到搜尋畫面 */
function finishTrip() {
  stopRideWatch()
  journey.value = null
  stopOnlyArrived.value = false
  end()
}

function speakOrBuzz(cue: Cue) {
  log(`${cueText(cue, 'zh-TW')}${cue.haptic ? `  [震動 ${cue.haptic}]` : ''}${cue.speak ? '' : '  [不出聲]'}`)
  // 用使用者選的語言念出來；城市通裡走 App 的 speak Handler，瀏覽器用 Web Speech
  if (cue.speak) speakText(cueText(cue, L.value), SPEECH_LANGS[L.value], langAudience.value.audience === 'elder' ? 'slow' : 'normal')
  if (cue.haptic && 'vibrate' in navigator) {
    navigator.vibrate(cue.haptic === 'arrive' ? [200, 80, 200, 80, 400] : cue.haptic === 'turn' ? [150] : [100, 60, 100])
  }
}

async function begin(simStart?: LatLon) {
  stopAll()
  cues.value = []
  announcer.reset()

  routeInfo.value = null
  routeError.value = ''

  active = destination.value
  activeName.value = active.name
  activeIsStation.value = !!active.station
  activeRide.value = active.stationRoute ? { route: active.stationRoute, alight: active.alight ?? null } : null
  destinationPoint.value = null
  destLock = createDestinationLock(active)
  gpsCourse.value = null
  courseFrom = null
  manual = null
  const useSim = simGps.value
  const rec = createTraceRecorder(useSim ? 'route+sim-gps' : 'route')
  recorder = rec
  traceCount.value = 0

  const heading = new WebSensorSource({ position: false })
  if (useSim) {
    manual = new ManualGpsSource({ start: simFallbackStart(), headingSource: heading })
    source = manual
  } else {
    source = new WebSensorSource()
  }
  machine = createNavMachine({ route: null })

  // 「開始走」的點擊事件內要求權限（iOS 羅盤）
  const perm = await source.requestPermission()
  permissionNote.value = perm === 'denied' ? '羅盤權限被拒絕，改用滑桿' : ''
  if (perm === 'denied') useManualHeading.value = true

  // 模擬 GPS 的起點：先試真實位置，拿不到就用預設點
  if (manual && simStart) {
    manual.moveTo(simStart)
    simNote.value = '模擬 GPS：從下車站出發'
  } else if (manual) {
    const real = await currentPositionOnce()
    manual.moveTo(real ?? simFallbackStart())
    simNote.value = real ? '模擬 GPS：從你現在的位置出發' : '模擬 GPS：拿不到位置，從目的地南方約 400 公尺出發'
  } else {
    simNote.value = ''
  }

  const m = machine
  arrivedHandled = false
  m.subscribe((v) => {
    view.value = v
    rec.view(v)
    traceCount.value = rec.count
    announcer.update(v).forEach(speakOrBuzz) // 抵達那句只震動，不出聲
    if (v.state === 'arrived' && !arrivedHandled) {
      arrivedHandled = true
      onWalkArrived()
    }
  })
  m.onEffect((e) => void fetchRealRoute(m, e.from, e.candidate))

  // 機器發現感測器沒資料、卡住、或羅盤與 GPS 走向不符：自動重新接上
  m.onResync((reason) => {
    log(`自動重新定位：${RESYNC_TEXT[reason]}`)
    source?.resync?.()
  })

  m.start()
  lastTickAt = Date.now()
  source.start({
    onHeading: (d) => {
      if (useManualHeading.value) return
      rec.heading(d)
      m.onHeading(d)
    },
    onPosition: (p) => {
      rec.position(p)
      updateCourse(p)
      // 真實 GPS 的位置也記下來：中斷導航後再搜尋，用的是這裡（模擬 GPS 不算）
      if (!useSim) locator.feed([p.lat, p.lon], p.accuracyM)
      m.onPosition(p)
    },
    onError: (c) => {
      log(`感測錯誤 ${c}`)
      m.onError(c)
    },
  })
  tickTimer = window.setInterval(() => {
    const now = Date.now()
    // 計時器被凍結過（WebView 進背景、換頁後回來，不一定有 visibilitychange）：感測器多半也卡住了
    if (now - lastTickAt > RESUME_GAP_MS) recalibrate('resumed')
    lastTickAt = now
    if (useManualHeading.value) {
      rec.heading(manualHeading.value)
      m.onHeading(manualHeading.value) // 手動朝向要持續餵，不然會被判斷成沒有羅盤
    }
    m.tick()
  }, 1000)
  const ok = await wake.on()
  wakeNote.value = ok ? '螢幕常亮已開' : wake.supported ? '螢幕常亮失敗' : '此環境不支援螢幕常亮'
  running.value = true
}

/** 向 Valhalla 要從目前位置到目的地的步行路線（避開階梯、小巷）；重新規劃也走這裡 */
async function fetchRealRoute(m: NavMachine, from: LatLon, candidate: string | null) {
  const to = destLock.pick(from)
  destinationPoint.value = to
  if (candidate !== null && rerouteFails.value) {
    // 模擬重算失敗：不給新路線，箭頭指最近的路線點
    log('（模擬）重算失敗，帶你回原路線')
    giveRoute(m, null)
    return
  }
  try {
    const route = await fetchWalkRoute(from, to, { id: candidate ?? 'walk-valhalla' })
    if (machine !== m) return // 使用者已經結束
    routeInfo.value = route
    routeError.value = ''
    log(`路線 ${route.distanceM} 公尺，約 ${Math.round(route.durationS / 60)} 分鐘，階梯 ${route.stairsCount} 段`)
    giveRoute(m, route)
  } catch (err) {
    if (machine !== m) return
    routeError.value = `取得路線失敗：${(err as Error).message}`
    log(routeError.value)
    giveRoute(m, null)
  }
}

/** 回覆路線，順便記進軌跡 */
function giveRoute(m: NavMachine, r: NavRoute | null) {
  recorder?.route(r)
  m.routeResult(r)
}

/** 取一次真實位置（模擬 GPS 的起點），5 秒內拿不到就放棄 */
function currentPositionOnce(): Promise<LatLon | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
    ),
  )
}

/** 連續定位移動 5 公尺以上，就更新行進方向。直走時它應該和羅盤朝向差不多 */
function updateCourse(p: PositionFix) {
  const here: LatLon = [p.lat, p.lon]
  if (!courseFrom) {
    courseFrom = here
    return
  }
  if (distanceM(courseFrom, here) >= 5) {
    gpsCourse.value = bearingDeg(courseFrom, here)
    courseFrom = here
  }
}

const courseDiff = computed(() => {
  const h = view.value?.headingDeg
  if (gpsCourse.value === null || h === null || h === undefined) return null
  const d = Math.abs((((gpsCourse.value - h) % 360) + 360) % 360)
  return Math.round(Math.min(d, 360 - d))
})

/** 模擬 GPS（鍵盤）：以目前朝向為前方，一次移動 KEY_STEP_M 公尺 */
function simMove(forward: number, right: number) {
  if (!manual) return
  const h = joyForwardDeg()
  manual.step(h, forward * KEY_STEP_M, right * KEY_STEP_M)
}

// 搖桿：按住時每 100 ms 依推的程度移動，位置每 500 ms 送出一次（接近真實 GPS 的頻率）
let joy: JoystickVector = { forward: 0, right: 0, knobX: 0, knobY: 0 }
let lastJoyEmitAt = 0
function onJoystick(v: JoystickVector) {
  const wasMoving = joy.forward !== 0 || joy.right !== 0
  joy = v
  // 放開時立刻送出停下來的位置
  if (wasMoving && v.forward === 0 && v.right === 0) manual?.emitNow()
}
const joyTimer = window.setInterval(() => {
  if (!manual || (joy.forward === 0 && joy.right === 0)) return
  const h = joyForwardDeg()
  const m = simSpeed.value * 0.1
  manual.step(h, joy.forward * m, joy.right * m, { emit: false })
  const now = Date.now()
  if (now - lastJoyEmitAt >= 500) {
    lastJoyEmitAt = now
    manual.emitNow()
  }
}, 100)
onBeforeUnmount(() => window.clearInterval(joyTimer))

function simPick(p: LatLon) {
  manual?.moveTo(p)
}

function onKey(e: KeyboardEvent) {
  if (!running.value) return
  const moves: Record<string, [number, number]> = {
    ArrowUp: [1, 0],
    ArrowDown: [-1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  const mv = moves[e.key]
  if (mv && manual) {
    e.preventDefault()
    simMove(mv[0], mv[1])
    return
  }
  // Q／E：手動朝向左右轉 15°（電腦上沒有羅盤時用）
  if (e.key === 'q' || e.key === 'e') {
    useManualHeading.value = true
    manualHeading.value = (manualHeading.value + (e.key === 'q' ? -15 : 15) + 360) % 360
    onManualHeading()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function traceJson(): string {
  return JSON.stringify(recorder?.toJSON() ?? null)
}

function downloadTrace() {
  if (!recorder) return
  const blob = new Blob([traceJson()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `nav-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function copyTrace() {
  try {
    await navigator.clipboard.writeText(traceJson())
    log('軌跡已複製')
  } catch {
    log('無法複製，請改用下載')
  }
}

/**
 * 重新定位：忘掉舊的朝向、重新接上羅盤與 GPS、重新取得螢幕常亮。
 * 使用者按按鈕、頁面回到前景、計時器被凍結過都會走這裡。
 */
function recalibrate(reason: 'manual' | 'resumed') {
  if (!machine || !source) return
  log(`重新定位：${RESYNC_TEXT[reason]}`)
  machine.resync()
  source.resync?.()
  void wake.on()
  lastTickAt = Date.now()
}

function onVisibility() {
  if (document.visibilityState === 'visible' && running.value) recalibrate('resumed')
}

function onPageShow(e: PageTransitionEvent) {
  if (e.persisted && running.value) recalibrate('resumed')
}

document.addEventListener('visibilitychange', onVisibility)
window.addEventListener('pageshow', onPageShow)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pageshow', onPageShow)
})

function stopAll() {
  if (tickTimer) window.clearInterval(tickTimer)
  tickTimer = null
  source?.stop()
  source = null
  manual = null
  machine = null
  void wake.off()
  running.value = false
}

function end() {
  stopAll()
  view.value = null
  // 回到搜尋畫面：結果的距離改用現在的位置
  void rerankWithCurrentPosition()
}

function onManualHeading() {
  if (useManualHeading.value) machine?.onHeading(manualHeading.value)
}

onBeforeUnmount(() => {
  stopAll()
  stopRideWatch()
})

// 箭頭每一幀往目標角度內插，直接寫 DOM（不經 Vue 重繪、不用 CSS transition）。
// 感測事件 10 Hz 或 60 Hz 都一樣順，延遲約 headingTauMs + arrowTauMs。
const arrowEl = ref<SVGSVGElement | null>(null)
let shownRotation = 0
let lastFrameAt = 0
let rafId = 0
function frame(t: number) {
  const target = view.value?.cssRotation
  const dt = lastFrameAt ? t - lastFrameAt : 16
  lastFrameAt = t
  if (target !== undefined) shownRotation = easeRotation(shownRotation, target, dt, NAV_CONFIG.arrowTauMs)
  if (arrowEl.value) arrowEl.value.style.transform = `rotate(${shownRotation}deg)`
  rafId = requestAnimationFrame(frame)
}
onMounted(() => {
  rafId = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(rafId))

</script>

<template>
  <div
    class="flex min-h-dvh flex-col text-white"
    :style="{ background: running && view ? BG[view.state] : '#30383D' }"
  >
    <!-- 選語言：第一次打開，或按右上角 🌐 -->
    <div v-if="showLangPicker" class="fixed inset-0 z-40 overflow-y-auto">
      <LanguagePicker :current="chosenLang" @pick="pickLang" />
    </div>

    <!-- 行程中的到站、坐車、抵達畫面：蓋在整頁上，不跳頁 -->
    <div v-if="journey?.phase === 'at_stop' && atStopTrip" class="fixed inset-0 z-20 overflow-y-auto">
      <ArrivalCard
        :trip="atStopTrip"
        :lang="langAudience.lang"
        :audience="langAudience.audience"
        :primary-label="boardedLabel"
        :place="finalPlace"
        @primary="onBoarded"
      />
    </div>
    <div v-else-if="journey?.phase === 'ride' && atStopTrip" class="fixed inset-0 z-20 overflow-y-auto">
      <RideCard
        :trip="atStopTrip"
        :lang="langAudience.lang"
        :audience="langAudience.audience"
        :status="rideNow"
        :simulate="simGps"
        :place="finalPlace"
        @got-off="onGotOff"
        @sim-next="simNextStop"
      />
    </div>
    <div v-else-if="journey?.phase === 'arrived' && finalTrip" class="fixed inset-0 z-20 overflow-y-auto">
      <ArrivalCard
        :trip="finalTrip"
        :lang="langAudience.lang"
        :audience="langAudience.audience"
        :primary-label="doneLabel"
        @primary="finishTrip"
      />
    </div>
    <div v-else-if="stopOnlyArrived && stopOnlyTrip" class="fixed inset-0 z-20 overflow-y-auto">
      <ArrivalCard
        :trip="stopOnlyTrip"
        :lang="langAudience.lang"
        :audience="langAudience.audience"
        :primary-label="doneLabel"
        @primary="finishTrip"
      />
    </div>

    <!-- 設定區：還沒開始時顯示 -->
    <section v-if="!running" class="space-y-4 p-4" :lang="L">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-white/50" lang="zh-TW">導航實驗</span>
        <button type="button" class="flex min-h-12 items-center gap-2 rounded-full bg-white/20 px-4 text-base font-bold" @click="pickingLang = true">
          <span aria-hidden="true">🌐</span>{{ t.language }}
        </button>
      </div>

      <!-- 目的地：輸入地址、路名、地標，或「緯度, 經度」 -->
      <form class="space-y-2" @submit.prevent="search">
        <label class="block text-2xl font-bold" for="dest-input">{{ t.whereTo }}</label>
        <div class="flex gap-2">
          <input
            id="dest-input"
            v-model="addressInput"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            :placeholder="t.placeholder"
            class="h-14 min-w-0 flex-1 rounded-xl bg-white px-4 text-lg text-[#30383D]"
          />
          <button
            type="submit"
            class="h-14 shrink-0 rounded-xl bg-white/20 px-5 text-lg font-bold disabled:opacity-50"
            :disabled="searching || !addressInput.trim()"
          >
            {{ searching ? t.searching : t.search }}
          </button>
        </div>
        <p class="text-sm text-white/70">{{ t.searchHint }}</p>
      </form>

      <p v-if="searchError" class="text-amber-200" role="alert">{{ t[searchError] }}</p>

      <!-- 外語搜尋：顯示換成的中文，使用者看得出來是用什麼搜的；有其他可能就給按鈕 -->
      <div v-if="translation" class="rounded-lg bg-white/10 p-3" aria-live="polite">
        <div class="text-lg">
          {{ translation.from }} →
          <span v-if="translation.to" class="font-bold" lang="zh-Hant">{{ translation.to }}</span>
          <span v-else class="text-amber-200">?</span>
        </div>
        <div v-if="translation.skipped.length" class="text-sm text-amber-200">? {{ translation.skipped.join(' ') }}</div>
        <div v-if="translation.alternatives.length" class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="alt in translation.alternatives"
            :key="alt"
            type="button"
            class="rounded-full bg-white/20 px-3 py-1 text-base"
            lang="zh-Hant"
            @click="searchFor(alt)"
          >
            {{ alt }}
          </button>
        </div>
      </div>

      <!-- 搭公車去：選了地址或店家 A 之後，搜尋結果收起來，這一區放在搜尋框正下方。用 TDX 停靠順序在裝置上算直達車 -->
      <section v-if="showBusPanel" ref="busPanel" class="scroll-mt-4 space-y-2" aria-label="搭公車去">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-xl font-bold">
            {{ fill(t.busTitle, { place: busTargetName }) }}
            <span v-if="busLoading || busOptions?.length" class="block text-sm font-normal text-white/70">{{ busIsTransfer ? t.busTransferOnly : t.busDirectFirst }}</span>
          </h2>
          <button type="button" class="shrink-0 rounded-lg bg-white/20 px-3 py-2 text-base" @click="reselectDestination">{{ t.reselect }}</button>
        </div>
        <p v-if="busLoading" class="text-white/80">{{ t.busLoading }}</p>
        <p v-if="busNote" class="text-amber-200">{{ t[busNote] }}</p>
        <button
          v-for="o in busOptions ?? []"
          :key="busKey(o)"
          type="button"
          class="block w-full rounded-lg bg-white/10 p-3 text-left"
          :class="{ 'ring-2 ring-white': isBusPicked(o) }"
          :aria-pressed="isBusPicked(o)"
          @click="pickBus(o)"
        >
          <div class="text-lg font-bold">{{ busLabel(o) }}</div>
          <ol class="mt-1 space-y-0.5 text-sm text-white/80">
            <li v-for="(line, li) in busPlanText(o, L)" :key="li">{{ line }}</li>
          </ol>
        </button>
        <button
          v-if="!busLoading"
          type="button"
          class="block w-full rounded-lg bg-white/10 p-3 text-left"
          :class="{ 'ring-2 ring-white': !pickedBus }"
          :aria-pressed="!pickedBus"
          @click="walkInstead"
        >
          <div class="text-lg font-bold">{{ t.walkInstead }}</div>
        </button>
      </section>

      <!-- 搜尋結果：地點、連鎖店在前（輸入目的地 A 就幫你找車），公車站牌在後（已經知道要搭哪班車） -->
      <template v-else>
        <!-- 地點與地址（後端 Overture 地標快照＋OpenStreetMap）：由近到遠 -->
        <section v-if="placeResults && placeResults.length" class="space-y-2" aria-label="地點與地址">
          <h2 class="text-lg font-bold">
            {{ t.places }}
            <span class="text-sm font-normal text-white/70">· {{ nearUser ? t.nearYou : t.nearStation }}</span>
          </h2>
          <button
            v-for="(p, i) in placeVisible"
            :key="`${p.name}-${p.point[0]}-${p.point[1]}-${i}`"
            type="button"
            class="block w-full rounded-lg bg-white/10 p-3 text-left"
            :class="{ 'ring-2 ring-white': isPlacePicked(p) }"
            :aria-pressed="isPlacePicked(p)"
            @click="pickPlace(p)"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-lg font-bold">{{ nameLines(p.name).main }}</span>
              <span class="shrink-0 text-sm text-white/80">{{ p.distanceM === null ? '' : placeDistance(p.distanceM, L) }}</span>
            </div>
            <div v-if="nameLines(p.name).sub" class="text-base text-white/90" lang="zh-Hant">{{ nameLines(p.name).sub }}</div>
            <div v-if="p.detail || p.category" class="text-sm text-white/70">{{ detailLines(p.category, p.address, p.detail).main }}</div>
            <div v-if="detailLines(p.category, p.address, p.detail).sub" class="text-xs text-white/50" lang="zh-Hant">{{ detailLines(p.category, p.address, p.detail).sub }}</div>
          </button>
          <button
            v-if="placeShown < placeResults.length"
            type="button"
            class="h-12 w-full rounded-lg bg-white/20 font-bold"
            @click="placeShown += PLACE_PAGE"
          >
            {{ fill(t.showMore, { n: placeResults.length - placeShown }) }}
          </button>
        </section>

        <!-- 連鎖店（Overture Maps 快照）：由近到遠 -->
        <section v-if="poiResults && poiResults.length" class="space-y-2" aria-label="連鎖店">
          <h2 class="text-lg font-bold">
            {{ t.chains }}
            <span class="text-sm font-normal text-white/70">· {{ nearUser ? t.nearYou : t.nearStation }}</span>
          </h2>
          <button
            v-for="p in poiVisible"
            :key="`${p.brand.key}-${p.point[0]}-${p.point[1]}`"
            type="button"
            class="block w-full rounded-lg bg-white/10 p-3 text-left"
            :class="{ 'ring-2 ring-white': isPoiPicked(p) }"
            :aria-pressed="isPoiPicked(p)"
            @click="pickPoi(p)"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-lg font-bold">{{ poiLines(p).main }}</span>
              <span class="shrink-0 text-sm text-white/80">{{ p.distanceM === null ? '' : placeDistance(p.distanceM, L) }}</span>
            </div>
            <div v-if="poiLines(p).sub" class="text-base text-white/90" lang="zh-Hant">{{ poiLines(p).sub }}</div>
            <div class="text-sm text-white/70">
              {{ displayLang && p.brand.en ? p.brand.en : p.brand.zh }}<template v-if="p.address"> · {{ (displayLang && labels.addresses.get(p.address)) || p.address }}</template>
            </div>
            <div v-if="displayLang && p.address && labels.addresses.get(p.address) && labels.addresses.get(p.address) !== p.address" class="text-xs text-white/50" lang="zh-Hant">{{ p.address }}</div>
          </button>
          <button
            v-if="poiShown < poiResults.length"
            type="button"
            class="h-12 w-full rounded-lg bg-white/20 font-bold"
            @click="poiShown += POI_PAGE"
          >
            {{ fill(t.showMore, { n: poiResults.length - poiShown }) }}
          </button>
        </section>

        <!-- 公車站牌（TDX 快照）：一個站位一張卡，點路線就是選那班車 -->
        <section v-if="stopResults && stopResults.length" class="space-y-2" aria-label="公車站牌">
          <h2 class="text-lg font-bold">
            {{ t.stops }}
            <span class="text-sm font-normal text-white/70">· {{ t.stopsHint }}</span>
          </h2>
          <div v-for="st in stopResults" :key="st.stationUid" class="rounded-lg bg-white/10 p-3">
            <div class="text-lg font-bold">
              {{ stopLines(st).main }}
              <span v-if="st.bearing && L === 'zh-TW'" class="text-sm font-normal text-white/70">（站位朝{{ BEARING_TEXT[st.bearing] ?? st.bearing }}）</span>
            </div>
            <div v-if="stopLines(st).sub" class="text-base text-white/90" lang="zh-Hant">{{ stopLines(st).sub }}</div>
            <div class="mb-2 text-sm text-white/70">{{ t.pickRoute }}</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="r in st.routes"
                :key="r.stopUid"
                type="button"
                class="rounded-full px-3 py-2 text-base"
                :class="isRoutePicked(st, r) ? 'bg-white font-bold text-[#30383D]' : 'bg-white/20'"
                :aria-pressed="isRoutePicked(st, r)"
                @click="pickStopRoute(st, r)"
              >
                {{ routeLabel(r) }}
              </button>
            </div>
          </div>
        </section>

      </template>

      <p v-if="stopResults || placeResults || poiResults" class="text-xs text-white/60">
        資料：公車站牌為 TDX 公車站位資料<template v-if="stopsUpdatedAt">（{{ stopsUpdatedAt.slice(0, 16).replace('T', ' ') }} 版）</template>；
        連鎖店與地標為 Overture Maps Foundation Places<template v-if="poiRelease">（{{ poiRelease }} 版）</template>
        （CDLA-Permissive-2.0／Apache-2.0／CC0-1.0），可能有已歇業或位置差幾十公尺的店；
        地址為 © OpenStreetMap contributors。找不到時改搜站名或路名。
      </p>

      <div class="rounded-lg bg-white/10 p-3">
        <div class="text-sm text-white/70">{{ t.currentDest }}</div>
        <div class="text-xl font-bold">{{ destination.name }}</div>
        <div v-if="destination.stationRoute" class="text-lg">{{ fill(t.takeBus, { bus: routeLabel(destination.stationRoute) }) }}</div>
        <div v-if="destination.alight" class="text-lg">{{ fill(ARRIVAL_STRINGS[L].getOffAt, { stop: stopName(destination.alight.name, L) }) }}</div>
        <button v-if="L === 'zh-TW' && destination.stationRoute?.stopUid !== DEFAULT_DESTINATION.stationRoute?.stopUid" type="button" class="mt-1 text-sm underline" @click="useDemoStation">
          改回預設站牌「{{ DEFAULT_DESTINATION.name }}」{{ DEFAULT_DESTINATION.stationRoute ? routeLabel(DEFAULT_DESTINATION.stationRoute) : '' }}
        </button>
        <div v-if="L !== 'zh-TW'" />
        <div v-else-if="destination.station" class="text-sm text-white/70">公車站牌：走到會跳到 /arrived，念「等 {{ destination.stationRoute?.routeName.zh }} 號」</div>
        <div v-else class="text-sm text-white/70">一般地點：走到只顯示「到了」</div>
      </div>

      <label class="flex items-center gap-2 rounded-lg bg-white/10 p-3" lang="zh-TW">
        <input v-model="simGps" type="checkbox" />
        <span>模擬 GPS（拖曳搖桿或點地圖移動，不用出門；朝向仍用手機羅盤）</span>
      </label>

      <p class="text-sm text-white/70">{{ t.realGpsHint }}</p>
      <button class="h-16 w-full rounded-xl bg-white text-lg font-bold text-[#30383D]" @click="startTrip">{{ t.start }}</button>
      <p v-if="permissionNote" class="text-amber-200">{{ permissionNote }}</p>
      <router-link class="block text-center underline" to="/lab/sensors" lang="zh-TW">← 感測實驗</router-link>
    </section>

    <!-- 導航畫面 -->
    <template v-else-if="view">
      <div class="px-4 pt-10 text-center" :lang="L">
        <div class="text-2xl font-bold">{{ activeName }}</div>
        <div v-if="activeRoute" class="text-xl">{{ activeRoute }}</div>
        <div class="text-lg">
          <template v-if="routeInfo">{{ fill(t.totalRoute, { m: placeDistance(routeInfo.distanceM, L), min: Math.max(1, Math.round(routeInfo.durationS / 60)) }) }}</template>
          <template v-else>{{ t.planning }}</template>
        </div>
      </div>

      <div class="flex flex-1 items-center justify-center">
        <svg
          v-if="showArrow"
          ref="arrowEl"
          class="w-[60vw] max-w-72 will-change-transform"
          viewBox="0 0 100 100"
        >
          <path
            d="M50 6 L88 88 L50 70 L12 88 Z"
            :fill="view.hollowArrow ? 'none' : '#fff'"
            stroke="#fff"
            stroke-width="5"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else-if="view.state === 'arrived'" class="w-[40vw] max-w-56" viewBox="0 0 100 100">
          <path d="M20 54 L42 76 L82 28" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div v-else-if="view.state === 'locating' || view.state === 'routing'" class="text-lg" :lang="L">{{ t.pleaseWait }}</div>
      </div>

      <div class="px-4 pb-4 text-center" :lang="L">
        <div class="text-6xl font-bold tabular-nums">{{ bigText }}</div>
        <div class="mt-2 min-h-16 text-3xl">{{ sentence }}</div>
      </div>

      <!-- 模擬 GPS：圓形搖桿，拖曳移動，往上 = 手機目前朝向。電腦可用鍵盤方向鍵（每次 5 m），Q／E 轉向 -->
      <section v-if="simGps" class="space-y-2 px-4 pb-4">
        <div class="text-center text-sm opacity-80">{{ simNote }}</div>
        <Joystick @change="onJoystick" />
        <label class="flex items-center justify-center gap-2 text-sm">搖桿往上＝
          <select v-model="joyFrame" class="rounded bg-white/20 px-2 py-1">
            <option value="map">地圖上方（北）</option>
            <option value="phone">手機面對的方向</option>
          </select>
        </label>
        <label class="flex items-center justify-center gap-2 text-sm">推到底的速度
          <select v-model.number="simSpeed" class="rounded bg-white/20 px-2 py-1">
            <option :value="1.4">步行 1.4 m/s</option>
            <option :value="3">3 m/s</option>
            <option :value="6">6 m/s</option>
            <option :value="12">12 m/s</option>
          </select>
          ・點地圖可以瞬移
        </label>
      </section>

      <div v-if="showDebug || simGps" class="h-72 px-4 pb-4">
        <NavDebugMap
          class="overflow-hidden rounded-lg"
          :geometry="view.geometry"
          :here="view.here"
          :accuracy-m="view.accuracyM"
          :target="view.targetPoint"
          :nearest="view.nearestPoint"
          :heading-deg="view.headingDeg"
          :destination="destinationPoint"
          @pick="simPick"
        />
        <div class="mt-1 text-xs opacity-80">
          藍線：路線・橘線：箭頭指的點・虛線：羅盤朝向・綠點：目的地
        </div>
      </div>

      <div
        v-if="view.headingCheck === 'suspect' && !view.headingLost && view.state !== 'arrived'"
        class="mx-4 mb-3 rounded-lg bg-amber-200 px-3 py-2 text-center text-lg font-bold text-[#30383D]"
        role="status"
      >
        {{ t.headingSuspect }}
      </div>

      <div class="flex items-center justify-between px-6 pb-4">
        <button class="h-16 w-16 rounded-full bg-white text-2xl text-[#30383D]" :aria-label="t.endTrip" @click="end">✕</button>
        <button
          class="h-16 rounded-full bg-white px-6 text-lg font-bold text-[#30383D]"
          :aria-label="t.recalibrate"
          @click="recalibrate('manual')"
        >
          {{ t.recalibrate }}
        </button>
        <button
          class="h-16 w-16 rounded-full bg-white text-sm text-[#30383D]"
          aria-label="除錯面板"
          @click="showDebug = !showDebug"
        >
          除錯
        </button>
      </div>

      <!-- 實驗控制 -->
      <section v-if="showDebug" class="space-y-3 bg-black/50 p-4 text-sm">
        <div class="grid grid-cols-2 gap-x-3 gap-y-1">
          <div>狀態 {{ view.state }}</div>
          <div>精度 {{ view.accuracyM?.toFixed(0) ?? '—' }} m</div>
          <div>朝向(真北) {{ view.headingDeg?.toFixed(0) ?? '—' }}°</div>
          <div>箭頭 {{ view.arrowDeg?.toFixed(0) ?? '—' }}°</div>
          <div>羅盤檢查 {{ view.headingCheck }}</div>
          <div>羅盤偏差 {{ view.headingOffsetDeg?.toFixed(0) ?? '—' }}°</div>
          <div>進度 {{ Math.round(view.progress * 100) }}%</div>
          <div>下個轉彎 {{ view.nextTurn ? `${view.nextTurn.kind}${view.nextTurn.then ? `→${view.nextTurn.then}` : ''} ${view.nextTurn.distanceM.toFixed(0)}m` : '—' }}</div>
          <div class="col-span-2">
            GPS 行進方向 {{ gpsCourse === null ? '—（走 5 m 以上才有）' : `${gpsCourse.toFixed(0)}°` }}
            <template v-if="courseDiff !== null">・和羅盤差 {{ courseDiff }}°{{ courseDiff > 45 ? '（羅盤可能不準）' : '' }}</template>
          </div>
          <div class="col-span-2 flex gap-2">
            <button class="rounded bg-white/20 px-3 py-2" @click="downloadTrace">下載軌跡（{{ traceCount }} 筆）</button>
            <button class="rounded bg-white/20 px-3 py-2" @click="copyTrace">複製軌跡</button>
          </div>
          <div class="col-span-2">{{ wakeNote }}</div>
          <div v-if="routeInfo" class="col-span-2">
            路線 {{ routeInfo.distanceM }} m・階梯 {{ routeInfo.stairsCount }} 段・過馬路 {{ routeInfo.crossCount ?? '—' }} 次・
            {{ routeInfo.maneuvers.filter((x) => x.street).map((x) => x.street).join(' → ') || '無路名' }}
          </div>
          <div v-if="routeError" class="col-span-2 text-amber-200">{{ routeError }}</div>
        </div>

        <label class="flex items-center gap-2">
          <input v-model="rerouteFails" type="checkbox" /> 重新規劃會失敗（測 back_to_route）
        </label>

        <label class="flex items-center gap-2">
          <input v-model="useManualHeading" type="checkbox" @change="onManualHeading" /> 手動朝向（沒有羅盤時）
        </label>
        <input
          v-if="useManualHeading"
          v-model.number="manualHeading"
          type="range"
          min="0"
          max="359"
          class="w-full"
          @input="onManualHeading"
        />

        <div>
          <div class="font-bold">語音／震動紀錄</div>
          <div v-for="c in cues" :key="c" class="font-mono text-xs">{{ c }}</div>
        </div>
      </section>
    </template>
  </div>
</template>
