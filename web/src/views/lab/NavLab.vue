<script setup lang="ts">
/**
 * 導航實驗頁（N6 雛形）：把 nav/ 引擎接到畫面上，手機上可以直接測。
 * 用真實定位，向 Valhalla 要「避開階梯、小巷」的步行路線，導到使用者自己輸入的目的地：
 * 輸入站名、地址、路名、地標（或「緯度, 經度」）→ 搜尋 → 選一個結果 → 開始走。
 * - 公車站牌：查 TDX 站位快照（有現行站名和每個站位的路線、方向），選一班車；走到會跳到 /arrived。
 * - 連鎖店：便利商店、速食、連鎖餐廳（Overture Maps 快照，離線比對、依距離排序）；到了只在這個畫面顯示「到了」。
 * - 地點與地址：查 OpenStreetMap（Nominatim）；到了只在這個畫面顯示「到了」。
 * 文字是實驗用的中文；正式文案走 i18n（UI 負責）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { arrivalFromStation, tripFromQuery } from '@/arrival/arrival'
import type { LatLon, Station, StationRoute } from '@/lib/contract'
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
import { formatDistance, loadPoiIndex, searchPois } from '@/lib/poiSearch'
import type { PoiHit } from '@/lib/poiSearch'
import { planDirectBus } from '@/lib/directBus'
import type { DirectBusOption } from '@/lib/directBus'
import { loadStopIndex, searchStops } from '@/lib/stopSearch'
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

// 目的地：預設是示範站牌；搜尋後選一個結果就換成那個地點
const destination = shallowRef<Destination>(DEFAULT_DESTINATION)
const addressInput = ref('')
const searching = ref(false)
const searchError = ref('')
const stopResults = ref<Station[] | null>(null)
const placeResults = ref<Place[] | null>(null)
const poiResults = ref<PoiHit[] | null>(null)
const stopsUpdatedAt = ref('')
const poiRelease = ref('')
/** 連鎖店依距離排序用的參考點：使用者位置；拿不到就用臺北車站 */
const poiNearUser = ref(false)
const TAIPEI_STATION: LatLon = [25.0478, 121.517]

/**
 * 取一次目前位置（可用 1 分鐘內的快取）；拒絕或逾時回傳 null。
 * 不擋搜尋：搜尋先用臺北車站排序、立刻顯示，位置回來後再重新排序。
 */
let userPoint: LatLon | null = null
let userPointAsked: Promise<LatLon | null> | null = null
function askUserPoint(): Promise<LatLon | null> {
  userPointAsked ??= new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve((userPoint = [pos.coords.latitude, pos.coords.longitude])),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    )
  })
  return userPointAsked
}
let searchSeq = 0

const BEARING_TEXT: Record<string, string> = {
  N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北',
}

/** 同時查站牌（TDX 快照）、連鎖店（Overture 快照）和地點（OSM）；任何一邊失敗不影響其他 */
async function search() {
  const q = addressInput.value.trim()
  if (!q || searching.value) return
  searching.value = true
  const seq = ++searchSeq
  searchError.value = ''
  clearBusPlan()
  stopResults.value = null
  placeResults.value = null
  poiResults.value = null
  const [stops, pois, places] = await Promise.allSettled([
    loadStopIndex().then((idx) => {
      stopsUpdatedAt.value = idx.updatedAt
      return searchStops(idx, q, 20)
    }),
    loadPoiIndex().then((idx) => {
      poiRelease.value = idx.release
      poiNearUser.value = !!userPoint
      return searchPois(idx, q, { near: userPoint ?? TAIPEI_STATION, limit: POI_LIMIT })
    }),
    searchPlaces(q),
  ])
  stopResults.value = stops.status === 'fulfilled' ? stops.value : []
  poiResults.value = pois.status === 'fulfilled' ? pois.value : []
  placeResults.value = places.status === 'fulfilled' ? places.value : []
  poiShown.value = POI_PAGE
  const errors: string[] = []
  if (stops.status === 'rejected') errors.push(`站牌資料載入失敗（${(stops.reason as Error).message}）`)
  if (pois.status === 'rejected') errors.push(`連鎖店資料載入失敗（${(pois.reason as Error).message}）`)
  if (places.status === 'rejected') errors.push(`地點搜尋失敗（${(places.reason as Error).message}）`)
  if (errors.length) searchError.value = errors.join('；')
  else if (stopResults.value.length === 0 && poiResults.value.length === 0 && placeResults.value.length === 0) {
    searchError.value = '找不到這個地點，試試站名、路名、地標、連鎖店名（例如「全家」「麥當勞」），或「緯度, 經度」'
  }
  searching.value = false

  // 連鎖店有結果、但還不知道你在哪：現在才問位置，拿到再依距離重排（期間使用者可以先看結果）
  if (!userPoint && (poiResults.value?.length ?? 0) > 0) {
    const user = await askUserPoint()
    if (user && seq === searchSeq && pois.status === 'fulfilled') {
      const idx = await loadPoiIndex()
      poiResults.value = searchPois(idx, q, { near: user, limit: POI_LIMIT })
      poiNearUser.value = true
      poiShown.value = POI_PAGE
    }
  }
}

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
const busOptions = ref<DirectBusOption[] | null>(null)
const busLoading = ref(false)
const busNote = ref('')
const pickedBus = shallowRef<DirectBusOption | null>(null)
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
    const [idx, user] = await Promise.all([loadStopIndex(), userPoint ? Promise.resolve(userPoint) : askUserPoint()])
    if (seq !== busSeq) return
    if (!user) {
      busNote.value = '拿不到你的位置，無法列出搭公車的方法；可以直接走過去。'
      return
    }
    if (idx.patterns.length === 0) {
      busNote.value = '站牌資料沒有路線停靠順序（舊快照），無法列出搭公車的方法。'
      return
    }
    busOptions.value = planDirectBus(idx.stations, idx.patterns, user, target)
    if (busOptions.value.length === 0) busNote.value = '附近沒有直達的公車比直接走過去更省路，建議走過去。'
  } catch (e) {
    if (seq === busSeq) busNote.value = `公車資料載入失敗（${(e as Error).message}），可以直接走過去。`
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

function pickBus(o: DirectBusOption) {
  pickedBus.value = o
  destination.value = destinationFromBusOption(o)
}

function isBusPicked(o: DirectBusOption): boolean {
  return pickedBus.value === o
}

function busLabel(o: DirectBusOption): string {
  return `${o.route.routeName.zh}${o.route.headsign.zh ? ` ${o.route.headsign.zh}` : ''}`
}

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

function isPlacePicked(p: Place): boolean {
  const pt = destination.value.points[0]
  return !destination.value.station && !!pt && pt[0] === p.point[0] && pt[1] === p.point[1]
}

function isRoutePicked(station: Station, route: StationRoute): boolean {
  return destination.value.station?.stationUid === station.stationUid && destination.value.stationRoute?.stopUid === route.stopUid
}

function routeLabel(r: StationRoute): string {
  return `${r.routeName.zh}${r.headsign.zh ? ` ${r.headsign.zh}` : ''}`
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
const activeRoute = ref('')
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

const DIR_TEXT = {
  straight: '往這走',
  bear_left: '稍微向左',
  bear_right: '稍微向右',
  left: '向左轉',
  right: '向右轉',
  turn_around: '請向後轉',
} as const

const TURN_TEXT: Record<string, string> = {
  left: '左轉',
  right: '右轉',
  slight_left: '稍微向左',
  slight_right: '稍微向右',
  uturn: '迴轉',
  stairs: '有階梯',
}

function cueText(c: Cue): string {
  switch (c.key) {
    case 'start':
      return '請注意來車和紅綠燈'
    case 'turn_ahead':
      return `前面路口${TURN_TEXT[c.turn ?? ''] ?? '轉彎'}`
    case 'turn_around':
      return '請向後轉'
    case 'off_route':
      return '走偏了，正在重新找路'
    case 'weak_signal':
      return '定位不太準，請到空曠一點的地方'
    case 'arrived':
      return '到了'
  }
}

const bigText = computed(() => {
  const v = view.value
  if (!v) return ''
  switch (v.state) {
    case 'locating':
      return '正在找你的位置'
    case 'routing':
      return '正在找路'
    case 'weak_signal':
      return '定位不太準'
    case 'rerouting':
      return '走偏了'
    case 'arrived':
      return '到了'
    case 'failed':
      return v.failReason === 'location_denied' ? '沒有定位權限' : v.failReason === 'route_failed' ? '找不到路' : '定位失敗'
    default:
      if (v.headingLost) return '抓不到方向'
      return distanceText(v.distanceM)
  }
})

const sentence = computed(() => {
  const v = view.value
  if (!v) return ''
  if (v.headingLost && (v.state === 'navigating' || v.state === 'back_to_route')) return '請拿著手機畫 8 字'
  switch (v.state) {
    case 'weak_signal':
      return '請到空曠一點的地方'
    case 'rerouting':
      return '正在重新找路'
    case 'back_to_route':
      return '請回到剛才的路'
    case 'arrived':
      return activeIsStation.value ? '在這裡等公車' : '到達目的地了'
    case 'failed':
      return '請回上一頁再試一次'
    case 'navigating': {
      const t = v.nextTurn
      if (t && t.kind !== 'arrive' && t.distanceM <= 30) return `前面路口${TURN_TEXT[t.kind] ?? '轉彎'}`
      return v.direction ? DIR_TEXT[v.direction] : ''
    }
    default:
      return ''
  }
})

function distanceText(m: number | null): string {
  if (m === null) return '—'
  if (m < 10) return '快到了'
  const r = m >= 100 ? Math.round(m / 10) * 10 : Math.round(m / 5) * 5
  return `${r} 公尺`
}

const showArrow = computed(() => {
  const v = view.value
  return !!v && v.arrowDeg !== null && v.state !== 'arrived'
})

function log(line: string) {
  cues.value = [`${new Date().toLocaleTimeString()} ${line}`, ...cues.value].slice(0, 12)
}

const router = useRouter()
const currentRoute = useRoute()
let arrivedHandled = false

/**
 * 到站：跳到 /arrived，由那個畫面念「到了。等 203 號，往天母方向」（只念一次）。
 * 只有站牌目的地（帶 station 和 stationRoute）才會跳；使用者自己輸入的地址只在這個畫面顯示「到了」。
 * 語言與對象用 /lab/nav?lang=en&audience=elder 指定，沒給就是 zh-TW、visitor（正式流程由設定頁提供）。
 * 網址只帶站名、路線名和方向，不帶座標和 UID。
 */
function goArrived() {
  const { station, stationRoute } = active
  if (!station || !stationRoute) return
  const { lang, audience } = tripFromQuery(currentRoute.query)
  void router.push(arrivalFromStation(station, stationRoute, lang, audience, active.alight))
}

function speakOrBuzz(cue: Cue) {
  log(`${cueText(cue)}${cue.haptic ? `  [震動 ${cue.haptic}]` : ''}${cue.speak ? '' : '  [不出聲]'}`)
  // 實驗頁只用網頁能力；speak／haptic Handler 在步驟 6 與 APP 對接
  if (cue.haptic && 'vibrate' in navigator) {
    navigator.vibrate(cue.haptic === 'arrive' ? [200, 80, 200, 80, 400] : cue.haptic === 'turn' ? [150] : [100, 60, 100])
  }
}

async function begin() {
  stopAll()
  cues.value = []
  announcer.reset()

  routeInfo.value = null
  routeError.value = ''

  active = destination.value
  activeName.value = active.name
  activeIsStation.value = !!active.station
  activeRoute.value = active.stationRoute
    ? `搭 ${routeLabel(active.stationRoute)}${active.alight ? `，在 ${active.alight.name.zh} 下車` : ''}`
    : ''
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
  if (manual) {
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
      goArrived()
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
  const h = view.value?.headingDeg ?? 0
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
  const h = view.value?.headingDeg ?? 0
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
}

function onManualHeading() {
  if (useManualHeading.value) machine?.onHeading(manualHeading.value)
}

onBeforeUnmount(stopAll)

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
    <!-- 設定區：還沒開始時顯示 -->
    <section v-if="!running" class="space-y-4 p-4">
      <h1 class="text-xl font-bold">導航實驗</h1>

      <!-- 目的地：輸入地址、路名、地標，或「緯度, 經度」 -->
      <form class="space-y-2" @submit.prevent="search">
        <label class="block text-lg font-bold" for="dest-input">要去哪裡？</label>
        <div class="flex gap-2">
          <input
            id="dest-input"
            v-model="addressInput"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            placeholder="輸入站名、店名（全家、麥當勞）、地址或地標"
            class="h-14 min-w-0 flex-1 rounded-xl bg-white px-4 text-lg text-[#30383D]"
          />
          <button
            type="submit"
            class="h-14 shrink-0 rounded-xl bg-white/20 px-5 text-lg font-bold disabled:opacity-50"
            :disabled="searching || !addressInput.trim()"
          >
            {{ searching ? '搜尋中…' : '搜尋' }}
          </button>
        </div>
        <p class="text-sm text-white/70">
          站名查 TDX 站牌資料、連鎖店（7-11、全家、麥當勞、海底撈…）查本站的開放資料快照，這兩種都不會把輸入送到第三方；地址和地標會送到公開的 OpenStreetMap 搜尋服務。搜連鎖店會要一次你的位置來排序最近的；不給也行，改以臺北車站為準。
        </p>
      </form>

      <p v-if="searchError" class="text-amber-200" role="alert">{{ searchError }}</p>

      <!-- 搭公車去：選了地址或店家 A 之後，搜尋結果收起來，這一區放在搜尋框正下方。用 TDX 停靠順序在裝置上算直達車 -->
      <section v-if="showBusPanel" ref="busPanel" class="scroll-mt-4 space-y-2" aria-label="搭公車去">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-xl font-bold">
            去「{{ busTargetName }}」可以搭
            <span class="block text-sm font-normal text-white/70">只列直達車，不含轉乘</span>
          </h2>
          <button type="button" class="shrink-0 rounded-lg bg-white/20 px-3 py-2 text-base" @click="reselectDestination">重新選擇</button>
        </div>
        <p v-if="busLoading" class="text-white/80">正在算可以搭的車…</p>
        <p v-if="busNote" class="text-amber-200">{{ busNote }}</p>
        <button
          v-for="o in busOptions ?? []"
          :key="`${o.route.routeName.zh}-${o.route.direction}`"
          type="button"
          class="block w-full rounded-lg bg-white/10 p-3 text-left"
          :class="{ 'ring-2 ring-white': isBusPicked(o) }"
          :aria-pressed="isBusPicked(o)"
          @click="pickBus(o)"
        >
          <div class="text-lg font-bold">{{ busLabel(o) }}</div>
          <div class="text-sm text-white/80">
            走 {{ formatDistance(o.walkToBoardM) }}到「{{ o.board.name.zh }}」上車 → 坐 {{ o.stopCount }} 站 →
            在「{{ o.alight.name.zh }}」下車，再走 {{ formatDistance(o.walkFromAlightM) }}
          </div>
        </button>
        <button
          v-if="!busLoading"
          type="button"
          class="block w-full rounded-lg bg-white/10 p-3 text-left"
          :class="{ 'ring-2 ring-white': !pickedBus }"
          :aria-pressed="!pickedBus"
          @click="walkInstead"
        >
          <div class="text-lg font-bold">不搭車，直接走過去</div>
        </button>
      </section>

      <!-- 搜尋結果：地點、連鎖店在前（輸入目的地 A 就幫你找車），公車站牌在後（已經知道要搭哪班車） -->
      <template v-else>
        <!-- 地點與地址（OpenStreetMap） -->
        <section v-if="placeResults && placeResults.length" class="space-y-2" aria-label="地點與地址">
          <h2 class="text-lg font-bold">地點與地址</h2>
          <button
            v-for="(p, i) in placeResults"
            :key="`${p.name}-${i}`"
            type="button"
            class="block w-full rounded-lg bg-white/10 p-3 text-left"
            :class="{ 'ring-2 ring-white': isPlacePicked(p) }"
            :aria-pressed="isPlacePicked(p)"
            @click="pickPlace(p)"
          >
            <div class="text-lg font-bold">{{ p.name }}</div>
            <div v-if="p.detail" class="text-sm text-white/70">{{ p.detail }}</div>
          </button>
        </section>

        <!-- 連鎖店（Overture Maps 快照）：由近到遠 -->
        <section v-if="poiResults && poiResults.length" class="space-y-2" aria-label="連鎖店">
          <h2 class="text-lg font-bold">
            連鎖店
            <span class="text-sm font-normal text-white/70">
              （{{ poiResults.length >= POI_LIMIT ? `最近的 ${POI_LIMIT} 家` : `共 ${poiResults.length} 家` }}，離{{ poiNearUser ? '你' : '臺北車站' }}由近到遠）
            </span>
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
              <span class="text-lg font-bold">{{ p.name }}</span>
              <span class="shrink-0 text-sm text-white/80">{{ formatDistance(p.distanceM) }}</span>
            </div>
            <div class="text-sm text-white/70">{{ p.brand.zh }}<template v-if="p.address">・{{ p.address }}</template></div>
          </button>
          <button
            v-if="poiShown < poiResults.length"
            type="button"
            class="h-12 w-full rounded-lg bg-white/20 font-bold"
            @click="poiShown += POI_PAGE"
          >
            再多看一些（還有 {{ poiResults.length - poiShown }} 家）
          </button>
        </section>

        <!-- 公車站牌（TDX 快照）：一個站位一張卡，點路線就是選那班車 -->
        <section v-if="stopResults && stopResults.length" class="space-y-2" aria-label="公車站牌">
          <h2 class="text-lg font-bold">
            公車站牌
            <span class="text-sm font-normal text-white/70">（已經知道要搭哪一班車時用）</span>
          </h2>
          <div v-for="st in stopResults" :key="st.stationUid" class="rounded-lg bg-white/10 p-3">
            <div class="text-lg font-bold">
              {{ st.name.zh }}
              <span v-if="st.bearing" class="text-sm font-normal text-white/70">（站位朝{{ BEARING_TEXT[st.bearing] ?? st.bearing }}）</span>
            </div>
            <div class="mb-2 text-sm text-white/70">點下要搭的那一班車：</div>
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
        連鎖店為 Overture Maps Foundation Places<template v-if="poiRelease">（{{ poiRelease }} 版）</template>
        （CDLA-Permissive-2.0／Apache-2.0／CC0-1.0），可能有已歇業或位置差幾十公尺的店；
        地點為 © OpenStreetMap contributors。找不到時改搜站名或路名。
      </p>

      <div class="rounded-lg bg-white/10 p-3">
        <div class="text-sm text-white/70">目前的目的地</div>
        <div class="text-xl font-bold">{{ destination.name }}</div>
        <div v-if="destination.stationRoute" class="text-lg">搭 {{ routeLabel(destination.stationRoute) }}</div>
        <div v-if="destination.alight" class="text-lg">在 {{ destination.alight.name.zh }} 下車</div>
        <button v-if="destination.stationRoute?.stopUid !== DEFAULT_DESTINATION.stationRoute?.stopUid" type="button" class="mt-1 text-sm underline" @click="useDemoStation">
          改回預設站牌「{{ DEFAULT_DESTINATION.name }}」{{ DEFAULT_DESTINATION.stationRoute ? routeLabel(DEFAULT_DESTINATION.stationRoute) : '' }}
        </button>
        <div v-if="destination.station" class="text-sm text-white/70">公車站牌：走到會跳到 /arrived，念「等 {{ destination.stationRoute?.routeName.zh }} 號」</div>
        <div v-else class="text-sm text-white/70">一般地點：走到只顯示「到了」</div>
      </div>

      <label class="flex items-center gap-2 rounded-lg bg-white/10 p-3">
        <input v-model="simGps" type="checkbox" />
        <span>模擬 GPS（拖曳搖桿或點地圖移動，不用出門；朝向仍用手機羅盤）</span>
      </label>

      <p class="text-sm text-white/70">
        用真實定位，走到戶外；路線避開階梯、陡坡與小巷，會把你的座標送到公開的路徑服務。
      </p>
      <button class="h-16 w-full rounded-xl bg-white text-lg font-bold text-[#30383D]" @click="begin">開始走</button>
      <p v-if="permissionNote" class="text-amber-200">{{ permissionNote }}</p>
      <router-link class="block text-center underline" to="/lab/sensors">← 感測實驗</router-link>
    </section>

    <!-- 導航畫面 -->
    <template v-else-if="view">
      <div class="px-4 pt-10 text-center">
        <div class="text-2xl font-bold">{{ activeName }}</div>
        <div v-if="activeRoute" class="text-xl">{{ activeRoute }}</div>
        <div class="text-lg">
          <template v-if="routeInfo">全程 {{ routeInfo.distanceM }} 公尺，約 {{ Math.round(routeInfo.durationS / 60) }} 分鐘</template>
          <template v-else>正在規劃路線…</template>
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
        <div v-else-if="view.state === 'locating' || view.state === 'routing'" class="text-lg">請稍候…</div>
      </div>

      <div class="px-4 pb-4 text-center">
        <div class="text-6xl font-bold tabular-nums">{{ bigText }}</div>
        <div class="mt-2 min-h-16 text-3xl">{{ sentence }}</div>
      </div>

      <!-- 模擬 GPS：圓形搖桿，拖曳移動，往上 = 手機目前朝向。電腦可用鍵盤方向鍵（每次 5 m），Q／E 轉向 -->
      <section v-if="simGps" class="space-y-2 px-4 pb-4">
        <div class="text-center text-sm opacity-80">{{ simNote }}</div>
        <Joystick @change="onJoystick" />
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
        方向可能不準，請拿著手機畫 8 字，再按「重新定位」
      </div>

      <div class="flex items-center justify-between px-6 pb-4">
        <button class="h-16 w-16 rounded-full bg-white text-2xl text-[#30383D]" aria-label="結束" @click="end">✕</button>
        <button
          class="h-16 rounded-full bg-white px-6 text-lg font-bold text-[#30383D]"
          aria-label="重新定位"
          @click="recalibrate('manual')"
        >
          重新定位
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
          <div>下個轉彎 {{ view.nextTurn ? `${view.nextTurn.kind} ${view.nextTurn.distanceM.toFixed(0)}m` : '—' }}</div>
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
            路線 {{ routeInfo.distanceM }} m・階梯 {{ routeInfo.stairsCount }} 段・
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
