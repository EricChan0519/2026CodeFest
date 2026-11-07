<script setup lang="ts">
/**
 * 跟著箭頭走 · 主畫面（UI：yuchuan_ui_v4；導航：nav/ 引擎＋trip/ 行程）
 *
 * 整個畫面只有一個「共用箭頭」(.hero)：
 * 1. 開場在畫面中央轉一圈、重摔縮成主 logo（斜 45°），下方打字機打出「一鍵成行」。
 * 2. 第一次使用：語言、年紀、路線模式（快速／安全／平緩）清單由左滑入，箭頭在清單外側指著選項；點一個 → 箭頭戳一下、清單淡出。
 *    路線模式依年紀建議一個（兒童→安全、長者→平緩），箭頭先指著它。
 *    選過就跳過（存在手機）；搜尋欄右上角的小膠囊可以重選。?reset=1 清掉、?setup=1 強制再選一次。
 * 3. 搜尋：地點、連鎖店、公車站一起找（trip/useDestinationSearch），依現在位置由近到遠；結果出來箭頭滑到第一筆。
 *    - 地點／店家 → 「怎麼去？」：走路過去（依路線模式算的路，說出好在哪；和最快不同時也列出最快的路），
 *      或在裝置上算出的公車（直達或轉一次車）。路線模式的路不會比最快多花 20% 以上的時間（api/app/route_modes.py）。
 *    - 公車站 → 「要搭哪一班？」：那個站位的路線。
 * 4. 選好走法：像滑動解鎖一樣，箭頭推過那一列到右邊界，框淡出，箭頭放大滑回中央，接上真正的導航（trip/useTrip）。
 *    到上車站、坐車中、只到站牌時蓋上 ArrivalCard／RideCard；走到最後的目的地箭頭換成打勾。
 * 只動 transform/opacity：過場用 Web Animations，導航中用 rAF 平滑旋轉內層箭頭、轉到位就停。
 * 除錯工具：長按右上角 0.7 秒或 ?debug=1（地圖、模擬 GPS 搖桿、重算失敗、手動朝向、軌跡）。?demo=1 直接開模擬 GPS。
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ArrivalCard from '@/arrival/ArrivalCard.vue'
import RideCard from '@/arrival/RideCard.vue'
import { SPEECH_LANGS } from '@/arrival/arrival'
import { speakText } from '@/arrival/speech'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import { ARROW_STRINGS, distanceWords, fill } from '@/i18n/arrow'
import type { AgeKey, CompassKey, TurnWordKey } from '@/i18n/arrow'
import { ROUTE_MODE_STRINGS } from '@/i18n/routeMode'
import type { Audience, Lang, LatLon, ManeuverKind, RouteMode, Station } from '@/lib/contract'
import { poiNameForTranslation, stopLabel } from '@/lib/foreignSearch'
import { parseQuery } from '@/lib/fuzzy'
import { stationQuery } from '@/lib/placeSearch'
import { groupStops } from '@/lib/stopSearch'
import type { StopGroup } from '@/lib/stopSearch'
import { createLocator } from '@/lib/locator'
import type { ModeRoute } from '@/lib/modeRoute'
import { estimateBusMin } from '@/lib/transferBus'
import type { Cue } from '@/nav/announcer'
import { easeRotation } from '@/nav/arrow'
import { NAV_CONFIG } from '@/nav/config'
import { DEFAULT_DESTINATION } from '@/nav/destination'
import { distanceM } from '@/nav/geo'
import { useDestinationSearch } from '@/trip/useDestinationSearch'
import { useTrip } from '@/trip/useTrip'
import type { TripChoice } from '@/trip/useTrip'
import { useWalkPlan } from '@/trip/useWalkPlan'
import ArrowMark from './ArrowMark.vue'
import { K_LOGO, K_NAV, heroSize, innerT, outerT, poseAt, reducedMotion, shortestDelta } from './pose'
import type { Pose } from './pose'

const DebugSheet = defineAsyncComponent(() => import('./DebugSheet.vue'))

type StepName = 'lang' | 'age' | 'mode' | 'search' | 'how' | 'route'
type Phase = 'intro' | 'brand' | StepName | 'launch' | 'nav'
type StepState = 'off' | 'in' | 'out'
const STEP_NAMES: StepName[] = ['lang', 'age', 'mode', 'search', 'how', 'route']
const isStep = (p: Phase): p is StepName => (STEP_NAMES as string[]).includes(p)

/** 開場 logo 斜 45° */
const LOGO_DEG = 45
/** 在清單、搜尋欄外側時指向右（指著選項） */
const POINT_DEG = 90
/** 指著選項時，窄螢幕縮小箭頭，讓清單保有更多空間（箭頭長 ≈ 方塊邊長 × 0.72） */
const pointBox = () => (window.innerWidth <= 600 ? 26 : 36)
const K_POINT = 0.72
/** 箭頭尖端和框之間的空隙 */
const POINT_GAP = 8
const EASE_LIST = 'cubic-bezier(0.2, 0.9, 0.1, 1)' // 和 CSS 的 --ease-out 一樣
const EASE_MOVE = 'cubic-bezier(0.3, 0.7, 0.2, 1)'
/** logo 靜止後第一次飛去清單：從靜止慢慢起步（EASE_LIST 起步太陡，60Hz 手機第一格就跳 20 多 px） */
const EASE_LIFT = 'cubic-bezier(0.4, 0, 0.2, 1)'
const EASE_UNLOCK = 'cubic-bezier(0.55, 0, 0.25, 1)' // 推過去、在邊界輕輕停住
const T_INTRO = 1900
const T_LIST = 620
const T_MOVE = 300
const T_PRESS = 280
const T_FADE = 250
const T_UNLOCK = 650
const T_HOLD = 380
const T_LAUNCH_PAUSE = 700 // 標語淡出後留一點時間，只看見箭頭
const T_LAUNCH = 1200

/** 語言名稱用各自的語言寫，看得懂自己的語言就能選 */
const LANG_ITEMS: { id: Lang; label: string }[] = [
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'th', label: 'ไทย' },
  { id: 'vi', label: 'Tiếng Việt' },
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'km', label: 'ខ្មែរ' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]
/** 由上而下：一般、兒童、長者（key 沿用 youth，手機裡存過的選擇才不會失效） */
const AGE_ITEMS: AgeKey[] = ['youth', 'child', 'elder']
/** 年紀 → 抵達文字與語速用的對象（一般用一般設定） */
const AUDIENCE: Record<AgeKey, Audience> = { child: 'child', youth: 'visitor', elder: 'elder' }
/** 字級倍率（01 產品規格「對象設定」） */
const FONT_SCALE: Record<AgeKey, number> = { child: 1.1, youth: 1, elder: 1.2 }
const MODE_ITEMS: RouteMode[] = ['fast', 'safe', 'gentle']
/** 依年紀建議的路線模式（選單上標「建議」、箭頭先指著它） */
const SUGGESTED_MODE: Record<AgeKey, RouteMode> = { child: 'safe', youth: 'fast', elder: 'gentle' }
const KEY_LANG = 'arrow.lang'
const KEY_AGE = 'arrow.age'
const KEY_MODE = 'arrow.mode'

// ── 設定（存在手機） ───────────────────────────────
function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    // 無痕模式等存不了就算了，只是下次要再選
  }
}
const params = new URLSearchParams(location.search)
if (params.has('reset')) {
  save(KEY_LANG, null)
  save(KEY_AGE, null)
  save(KEY_MODE, null)
}
const savedLang = load(KEY_LANG) as Lang | null
const savedAge = load(KEY_AGE) as AgeKey | null
const savedMode = load(KEY_MODE) as RouteMode | null
const lang = ref<Lang>(savedLang && savedLang in ARROW_STRINGS ? savedLang : 'zh-TW')
const age = ref<AgeKey>(savedAge && AGE_ITEMS.includes(savedAge) ? savedAge : 'youth')
const mode = ref<RouteMode>(savedMode && MODE_ITEMS.includes(savedMode) ? savedMode : SUGGESTED_MODE[age.value])
/** 第一次使用（或 ?setup=1）才走語言、年紀、路線模式三步 */
const needSetup = !savedLang || !savedAge || !savedMode || params.has('setup')
const audience = computed(() => AUDIENCE[age.value])
/** Demo：白天展示晚上（安全模式的路燈權重變高），畫面標示「模擬晚上」 */
const simulate = params.has('night') ? ('night' as const) : null
const S = computed(() => ARROW_STRINGS[lang.value])
const R = computed(() => ROUTE_MODE_STRINGS[lang.value])
const A = computed(() => ARRIVAL_STRINGS[lang.value])
const langLabel = computed(() => LANG_ITEMS.find((l) => l.id === lang.value)?.label ?? '')

// ── 位置、搜尋、行程 ───────────────────────────────
const locator = createLocator()
const search = useDestinationSearch(locator, () => lang.value)
// 換語言時，現有結果重新翻成新語言
watch(lang, () => search.relabel())
const routing = { mode: () => mode.value, audience: () => audience.value, simulate: () => simulate }
const trip = useTrip({ locator, onCue, routing })
const nav = trip.nav
const walkPlan = useWalkPlan(locator, routing)
if (params.has('demo')) nav.simGps.value = true

const phase = ref<Phase>('intro')
const steps = reactive<Record<StepName, StepState>>({ lang: 'off', age: 'off', mode: 'off', search: 'off', how: 'off', route: 'off' })
const picked = ref(-1) // 剛被點的那一列
const busy = ref(false) // 過場中不收點擊
const launchMoving = ref(false) // 移動時逐漸切成導航箭頭，抵達後不再換形狀
const lift = ref(0) // 標語往上滑的距離
const root = ref<HTMLElement>()
const hero = ref<HTMLElement>()
const heroArrow = ref<HTMLElement>()
const logoSlot = ref<HTMLElement>()
const titleEl = ref<HTMLElement>()
const dock = ref<HTMLElement>()
const stepsEl = ref<HTMLElement>()
const navSlot = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const query = ref('')
const debugOpen = ref(false)
/** 「怎麼去」的目的地（地點、店家） */
const target = ref<{ name: string; point: LatLon } | null>(null)
/** 「要搭哪一班」的站牌（同名、相鄰的站位合併成一筆，每條路線記得自己的站位） */
const stopGroup = ref<StopGroup | null>(null)

// ── 共用箭頭 ─────────────────────────────────────────
let size = 240
let rot = 0 // 導航中的箭頭角度（累加）
let cur: Pose = { x: 0, y: 0, s: 1, r: 0, k: K_LOGO } // 箭頭目前（最後一段過場結束時）的姿勢
let navPose: Pose = { x: 0, y: 0, s: 1, r: 0, k: K_NAV }
let anims: Animation[] = []
let sweepAnim: Animation | undefined
let armRow = 0 // 箭頭目前指著哪一列；搜尋步驟的 -1 是搜尋欄
let seq = 0 // 每段過場的編號；被打斷時舊的 await 之後就不要再動
let fullH = 0 // 沒有鍵盤時的視窗高度（判斷鍵盤是否開著）

const dur = (ms: number): number => (reducedMotion() ? 0 : ms)
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/**
 * logo 斜 45° 時，箭頭（含圓角筆畫）的外框寬 ≈ 箭頭方塊的 0.74。
 * 依「一鍵成行」實際寬度決定箭頭比例：箭頭左右剛好對齊標語的頭尾，不會只蓋到第三個字。
 */
const LOGO_SPAN = 0.74
function logoK(): number {
  const ghost = titleEl.value?.querySelector<HTMLElement>('.ask-ghost')
  const slot = logoSlot.value
  if (!ghost || !slot) return K_LOGO
  // 最後一個字後面的字距不算
  const textW = ghost.getBoundingClientRect().width - parseFloat(getComputedStyle(ghost).letterSpacing || '0')
  const slotW = slot.getBoundingClientRect().width
  return textW > 0 && slotW > 0 ? textW / (LOGO_SPAN * slotW) : K_LOGO
}
const logoPose = (r: number): Pose => poseAt(logoSlot.value!, size, r, logoK())
const navPoseNow = (): Pose => poseAt(navSlot.value!, size, rot, K_NAV)
/** 最接近 r、指向右的角度（不多轉） */
const pointAngle = (r: number): number => Math.round((r - POINT_DEG) / 360) * 360 + POINT_DEG

function setHero(p: Pose) {
  cur = p
  hero.value!.style.transform = outerT(p)
  heroArrow.value!.style.transform = innerT(p)
}

interface Frame {
  p: Pose
  opacity?: number
  offset?: number
  easing?: string
}

/** 外層（位置、大小）與內層（角度）用同一組影格、同時播放；easing 是整段的曲線 */
function play(frames: Frame[], duration: number, easing = 'linear'): Promise<void> {
  anims.forEach((a) => a.cancel())
  const opt: KeyframeAnimationOptions = { duration, easing, fill: 'forwards' }
  const kf = (f: Frame, transform: string, withOpacity: boolean): Keyframe => {
    const k: Keyframe = { transform }
    if (withOpacity) k.opacity = f.opacity ?? 1
    if (f.offset !== undefined) k.offset = f.offset
    if (f.easing) k.easing = f.easing
    return k
  }
  const outer = hero.value!.animate(
    frames.map((f) => kf(f, outerT(f.p), true)),
    opt,
  )
  const inner = heroArrow.value!.animate(
    frames.map((f) => kf(f, innerT(f.p), false)),
    opt,
  )
  const mine = [outer, inner]
  anims = mine
  return new Promise((resolve) => {
    outer.onfinish = () => {
      const last = frames[frames.length - 1]!
      const el = hero.value!
      // 把終點寫回 inline style 時先關掉 CSS transition，並強制算一次樣式再打開：
      // Safari 會拿「動畫開始前的 inline transform」當起點，配上 .settled 的 0.35s 過渡，
      // 箭頭到位後會再抽一下（Chrome 用動畫當下的值，所以電腦上看不出來）
      el.style.transition = 'none'
      setHero(last.p)
      el.style.opacity = String(last.opacity ?? 1)
      mine.forEach((a) => a.cancel())
      void getComputedStyle(el).transform
      el.style.transition = ''
      if (anims === mine) anims = []
      resolve()
    }
    outer.oncancel = () => resolve()
  })
}

function measure(): boolean {
  const prev = size
  size = heroSize()
  root.value!.style.setProperty('--hero', `${size}px`)
  fullH = Math.max(fullH, window.innerHeight)
  return prev !== size
}

// ── 步驟（清單、搜尋欄）的位置 ───────────────────────
const stepEl = (s: StepName) => root.value!.querySelector<HTMLElement>(`[data-step="${s}"]`)!
/** 箭頭指著的框：清單的一列；搜尋步驟的 -1 是搜尋欄 */
const boxEl = (s: StepName, i: number) =>
  stepEl(s).querySelector<HTMLElement>(i < 0 ? '.search' : `[data-i="${i}"]`) ??
  stepEl(s).querySelector<HTMLElement>('.search, [data-i]')!
/** 步驟目前的水平位移（滑入中是負的） */
const stepDx = (s: StepName) => stepEl(s).getBoundingClientRect().left - stepsEl.value!.getBoundingClientRect().left

/**
 * 箭頭停在框的左外側、垂直置中、尖端離框 POINT_GAP（用框「滑入完成後」的位置）。
 * 框在可捲動的清單裡、被捲出畫面時，箭頭停在清單的上下緣，不會指到清單外面。
 */
function pointPose(s: StepName, i: number, r = pointAngle(cur.r)): Pose {
  const box = boxEl(s, i)
  const b = box.getBoundingClientRect()
  let cy = b.top + b.height / 2
  const list = box.closest('.list')
  if (list) {
    const l = list.getBoundingClientRect()
    const half = Math.min(b.height, l.height) / 2
    cy = Math.min(Math.max(cy, l.top + half), l.bottom - half)
  }
  const pb = pointBox()
  const cx = b.left - stepDx(s) - POINT_GAP - (pb * K_POINT) / 2
  return { x: cx - size / 2, y: cy - size / 2, s: pb / size, r, k: K_POINT }
}

/** 步驟由左滑入，箭頭同時滑到第一列外側（搜尋步驟是搜尋欄） */
async function enterStep(s: StepName, from: Pose = cur, easing = EASE_LIST) {
  const my = ++seq
  busy.value = true
  picked.value = -1
  sweepAnim?.cancel()
  sweepAnim = undefined
  phase.value = s
  steps[s] = 'in'
  await nextTick()
  // 等瀏覽器把新步驟排版、畫出第一格再量位置、開始動：手機第一次渲染清單比較久，
  // 同一格裡開始動畫會掉前幾格，看起來像箭頭先跳一下
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  if (my !== seq) return
  // 搜尋：指著搜尋欄；路線模式：指著依年紀建議的那個；
  // 怎麼去：公車已經算好就直接指著建議的第一班車（還在算的話，算好時由 watch 滑過去）
  armRow =
    s === 'search'
      ? -1
      : s === 'mode'
        ? MODE_ITEMS.indexOf(suggestedMode.value)
        : s === 'how' && !search.busLoading.value && search.busOptions.value.length
          ? walkRows.value.length
          : 0
  await play([{ p: from }, { p: pointPose(s, armRow, pointAngle(from.r)) }], dur(T_LIST), easing)
  if (my !== seq) return
  busy.value = false
}

/** 步驟淡出（清單整個一起） */
async function leaveStep(s: StepName, ms = T_FADE) {
  steps[s] = 'out'
  await wait(dur(ms))
  steps[s] = 'off'
}

/** 換到下一個步驟：目前的淡出、下一個由左滑入 */
async function goStep(from: StepName, to: StepName) {
  const my = ++seq
  busy.value = true
  await leaveStep(from)
  if (my !== seq) return
  await enterStep(to)
}

/** 箭頭上下滑到另一列（不按下去） */
async function moveArrow(s: StepName, i: number) {
  if (phase.value !== s || steps[s] !== 'in' || i === armRow) return
  const my = ++seq
  busy.value = true
  await nextTick()
  await play([{ p: cur }, { p: pointPose(s, i) }], dur(T_MOVE), EASE_MOVE)
  if (my !== seq) return
  armRow = i
  busy.value = false
  // 手機鍵盤收合或清單捲動可能發生在動畫途中；結束後重新量目前的位置。
  onResize()
}

/**
 * 按下一列：箭頭上下滑到那一列 → 往選項戳一下、那一列被按下去。
 * @returns 過場有沒有被打斷（被打斷就不要接著做下一步）
 */
async function press(s: StepName, i: number): Promise<boolean> {
  const my = ++seq
  busy.value = true
  if (i !== armRow) {
    await play([{ p: cur }, { p: pointPose(s, i) }], dur(T_MOVE), EASE_MOVE)
    if (my !== seq) return false
    armRow = i
  }
  navigator.vibrate?.(12)
  picked.value = i
  const at = cur
  const t = dur(T_PRESS)
  boxEl(s, i).animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.96)', offset: 0.35 },
      { transform: 'scale(1)' },
    ],
    { duration: t, easing: 'ease-out' },
  )
  await play(
    [
      { p: at, easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
      { p: { ...at, x: at.x + POINT_GAP }, offset: 0.35, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      { p: at },
    ],
    t,
  )
  if (my !== seq) return false
  await wait(dur(120))
  return my === seq
}

// ── 設定步驟 ─────────────────────────────────────────
async function pickLang(i: number) {
  if (busy.value || phase.value !== 'lang') return
  if (!(await press('lang', i))) return
  lang.value = LANG_ITEMS[i]!.id
  save(KEY_LANG, lang.value)
  await goStep('lang', 'age')
}

async function pickAge(i: number) {
  if (busy.value || phase.value !== 'age') return
  if (!(await press('age', i))) return
  age.value = AGE_ITEMS[i]!
  save(KEY_AGE, age.value)
  await goStep('age', 'mode')
}

const suggestedMode = computed(() => SUGGESTED_MODE[age.value])

async function pickMode(i: number) {
  if (busy.value || phase.value !== 'mode') return
  if (!(await press('mode', i))) return
  mode.value = MODE_ITEMS[i]!
  save(KEY_MODE, mode.value)
  await goStep('mode', 'search')
}

/** 搜尋欄右上角的膠囊：重選語言、使用者和路線模式 */
function changeSettings() {
  if (busy.value || phase.value !== 'search') return
  void goStep('search', 'lang')
}

// ── 搜尋結果 ─────────────────────────────────────────
const PAGE = 10
const placeShown = ref(PAGE)
const poiShown = ref(PAGE)
watch(
  () => search.places.value,
  () => {
    placeShown.value = PAGE
    poiShown.value = PAGE
  },
)

type Kind = 'place' | 'poi' | 'stop'
interface ResultRow {
  type: 'hit'
  key: string
  kind: Kind
  name: string
  /** 中文原名（招牌、站牌上看到的）；名稱已經是中文時是空字串 */
  zh: string
  dist: number | null
  point: LatLon
  stop?: StopGroup
  /** 這一組的第一筆：上面顯示組名 */
  head?: string
}
interface MoreRow {
  type: 'more'
  key: string
  kind: Kind
  left: number
}
type Row = ResultRow | MoreRow

/** 站名：zh-TW 用中文；其他語言有英文就用英文（01 的站名規則） */
const nameOf = (n: { zh: string | null; en: string | null }) =>
  (lang.value === 'zh-TW' ? n.zh || n.en : n.en || n.zh) ?? ''

/** 站名：使用者的語言（英文、印尼文用 TDX 官方英文站名），第二行附中文站名 */
function stopNames(st: Station): { name: string; zh: string } {
  const dl = search.displayLang.value
  const l = dl ? stopLabel(st, dl, search.labels.value.names) : null
  if (l && l.text !== st.name.zh) return { name: l.text, zh: st.name.zh }
  return { name: nameOf(st.name), zh: lang.value === 'zh-TW' ? '' : st.name.zh }
}

/** 列表上的距離：350 公尺、2.4 公里 */
function listDistance(m: number | null): string {
  if (m === null) return ''
  if (m < 1000) return fill(S.value.meters, { n: Math.max(10, Math.round(m / 10) * 10) })
  return fill(S.value.km, { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) })
}

/** 結果名稱：使用者的語言（翻不出來的部分照讀音），沒有就用中文；第二個值是要另外附上的中文原名 */
function localName(zh: string, key = zh): [string, string] {
  const l = search.displayLang.value ? search.labels.value.names.get(key) : undefined
  return l && l.text !== zh ? [l.text, zh] : [zh, '']
}

/**
 * 搜尋結果：每筆只有名稱和距離；外語介面再附中文原名對照招牌（2026-11-08 回報：下面那行小字太冗長）。
 * 分組順序：找車站（芝山捷運站、士林站）時地點在前（合併後的車站排第一）、公車站牌第二；
 * 找公車站牌（○○公車站、站牌）時站牌在前；其他搜尋地點、店家、站牌。
 */
const rows = computed<Row[]>(() => {
  const s = S.value
  const q = search.searchedQuery.value
  const placeRows: Row[] = []
  const placeAll = search.places.value
  placeAll.slice(0, placeShown.value).forEach((p, i) =>
    placeRows.push({
      type: 'hit',
      key: `pl-${p.name}-${p.point[0]}-${p.point[1]}-${i}`,
      kind: 'place',
      name: localName(p.name)[0],
      zh: localName(p.name)[1],
      dist: p.distanceM,
      point: p.point,
      head: i === 0 ? s.groupPlaces : undefined,
    }),
  )
  if (placeAll.length > placeShown.value) placeRows.push({ type: 'more', key: 'more-pl', kind: 'place', left: placeAll.length - placeShown.value })
  const poiRows: Row[] = []
  const poiAll = search.pois.value
  poiAll.slice(0, poiShown.value).forEach((p, i) =>
    poiRows.push({
      type: 'hit',
      key: `poi-${p.brand.key}-${p.point[0]}-${p.point[1]}`,
      kind: 'poi',
      name: localName(p.name, poiNameForTranslation(p.name, p.brand))[0],
      zh: localName(p.name, poiNameForTranslation(p.name, p.brand))[1],
      dist: p.distanceM,
      point: p.point,
      head: i === 0 ? s.groupStores : undefined,
    }),
  )
  if (poiAll.length > poiShown.value) poiRows.push({ type: 'more', key: 'more-poi', kind: 'poi', left: poiAll.length - poiShown.value })
  // 合併後的站牌用合併後的名稱（拿掉括號）翻譯；英文、印尼文用 TDX 官方英文站名
  const stopRows: Row[] = groupStops(search.stops.value, search.near.value).map((g, i) => ({
    type: 'hit',
    key: `st-${g.key}`,
    kind: 'stop',
    ...stopNames({ ...g.stations[0]!, name: g.name }),
    dist: distanceM(search.near.value, [g.lat, g.lon]),
    point: [g.lat, g.lon],
    stop: g,
    head: i === 0 ? s.groupStops : undefined,
  }))
  if (parseQuery(q).tags.includes('bus')) return [...stopRows, ...placeRows, ...poiRows]
  if (stationQuery(q)) return [...placeRows, ...stopRows, ...poiRows]
  return [...placeRows, ...poiRows, ...stopRows]
})
const hasResults = computed(() => rows.value.some((r) => r.type === 'hit'))
/** 資料出處（站牌 TDX、店家與地標 Overture、地址 OSM；OSM 的授權要求一定要標） */
const sourceLine = computed(() =>
  [
    ['TDX', search.stopsUpdatedAt.value.slice(0, 10)],
    ['Overture Maps Places', search.poiRelease.value],
    ['© OpenStreetMap contributors', ''],
  ]
    .map(([name, ver]) => (ver ? `${name} ${ver}` : name))
    .join(' · '),
)
const searchNote = computed(() => {
  if (search.searching.value || !search.searched.value) return ''
  if (!hasResults.value) return search.errors.value.length ? S.value.someFailed : S.value.noResult
  return search.errors.value.length ? S.value.someFailed : ''
})

function showMore(r: MoreRow) {
  if (r.kind === 'place') placeShown.value += PAGE
  else poiShown.value += PAGE
}

/** 收鍵盤：鍵盤開著就等版面恢復（搜尋欄在畫面中央，鍵盤收起時會往下移） */
async function closeKeyboard() {
  const open = window.innerHeight < fullH - 120
  input.value?.blur()
  if (!open) return
  await new Promise<void>((resolve) => {
    let t = setTimeout(done, 600)
    function done() {
      window.removeEventListener('resize', onR)
      resolve()
    }
    function onR() {
      clearTimeout(t)
      t = setTimeout(done, 120) // 版面停止變動 120 ms 就算收好了
    }
    window.addEventListener('resize', onR)
  })
  await new Promise((r) => requestAnimationFrame(r))
}

/** 送出搜尋：結果出來後箭頭滑到第一筆 */
async function submitSearch() {
  const q = query.value.trim()
  if (!q || phase.value !== 'search' || search.searching.value) return
  const kb = closeKeyboard()
  await search.search(q)
  await kb
  const first = rows.value.findIndex((r) => r.type === 'hit')
  if (first >= 0 && !busy.value) await moveArrow('search', first)
  if (phase.value === 'search' && !busy.value) onResize()
}

/** 外語搜尋的「也可能是…」：用那個中文重新搜尋 */
function searchAlt(text: string) {
  query.value = text
  void submitSearch()
}

/** 點搜尋欄要改字：箭頭回到搜尋欄 */
function onSearchFocus() {
  if (!busy.value && armRow !== -1) void moveArrow('search', -1)
}

async function pickResult(i: number) {
  const r = rows.value[i]
  if (!r || r.type !== 'hit' || busy.value || phase.value !== 'search') return
  if (!(await press('search', i))) return
  if (r.kind === 'stop' && r.stop) {
    stopGroup.value = r.stop
    await goStep('search', 'route')
    return
  }
  target.value = { name: r.name, point: r.point }
  void search.planTo(r.point)
  void walkPlan.planTo(r.point)
  await goStep('search', 'how')
}

// ── 怎麼去／要搭哪一班 ───────────────────────────────
interface HowRow {
  key: string
  title: string
  right: string
  choice: TripChoice
}
/** 約幾分鐘（路線的時間；長者用 3.5 km/h 算） */
const routeMin = (r: ModeRoute) => Math.max(1, Math.round(r.durationS / 60))

/**
 * 「怎麼去」只有幾個大選項，每個一列、只寫名稱和約幾分鐘（2026-11-08 回報：選項和小字太多）。
 * 走路：依使用者選的路線模式算好的那一條（routes[0]）；還在算時先用直線距離估時間。
 */
const walkRows = computed<HowRow[]>(() => {
  const t = target.value
  if (!t) return []
  const s = S.value
  const plan = walkPlan.plan.value
  const route = plan?.routes[0]
  if (!plan || !route) {
    return [
      {
        key: 'walk',
        title: s.howWalk,
        right: search.walkMin.value ? fill(s.aboutMin, { min: search.walkMin.value }) : '',
        choice: { kind: 'walk', name: t.name, point: t.point },
      },
    ]
  }
  const isMode = route.id !== 'fastest'
  return [
    {
      key: 'walk',
      title: s.howWalk,
      right: fill(s.aboutMin, { min: routeMin(route) }),
      choice: { kind: 'walk', name: t.name, point: t.point, route, from: plan.from, mode: isMode ? plan.mode : 'fast' },
    },
  ]
})
/** 走路的說明只留要讓人知道的：後端連不上只能走最快的路、模擬晚上 */
const routeNote = computed(() => {
  const plan = walkPlan.plan.value
  const r = R.value
  if (!plan) return ''
  const parts = [plan.fallback && plan.mode !== 'fast' ? r.fallback : '', plan.notes.includes('simulated_night') ? r.simNight : '']
  return parts.filter(Boolean).join(' · ')
})
/** 公車：只列最快的一個搭法（直達或轉一次車），搭哪一班、在哪下車導航時再說 */
const howRows = computed<HowRow[]>(() => {
  const t = target.value
  if (!t) return []
  const s = S.value
  const best = search.busOptions.value
    .map((p) => ({ p, min: Math.max(1, Math.round(estimateBusMin(p))) }))
    .sort((a, b) => a.min - b.min)[0]
  const bus: HowRow[] = best
    ? [{ key: 'bus', title: s.howBus, right: fill(s.aboutMin, { min: best.min }), choice: { kind: 'bus', plan: best.p, name: t.name, point: t.point } }]
    : []
  return [...walkRows.value, ...bus]
})
const howNote = computed(() => {
  if (search.busLoading.value) return S.value.busLoading
  switch (search.busNote.value) {
    case 'not_worth':
      return S.value.busNotWorth
    case 'no_position':
      return S.value.busNoPosition
    case 'failed':
    case 'old_index':
      return S.value.busFailed
    default:
      return ''
  }
})
// 公車算好了：箭頭往下滑到建議的第一班車
watch(
  () => search.busLoading.value,
  async (loading) => {
    if (loading || phase.value !== 'how' || search.busOptions.value.length === 0) return
    await nextTick()
    if (!busy.value && armRow === 0) await moveArrow('how', walkRows.value.length)
  },
)

const routeRows = computed(() => stopGroup.value?.routes ?? [])
/** 只有一個站位時才標朝哪個方向；合併了兩個方向時每條路線的「往哪裡」已經說清楚 */
const stationFacing = computed(() => {
  const g = stopGroup.value
  const b = g && g.stations.length === 1 ? g.stations[0]!.bearing : null
  return b && b in S.value.compass ? fill(S.value.stopFacing, { dir: S.value.compass[b as CompassKey] }) : ''
})

function back(from: 'how' | 'route') {
  if (busy.value || phase.value !== from) return
  search.clearBus()
  walkPlan.clear()
  void goStep(from, 'search')
}

function pickHow(i: number) {
  const r = howRows.value[i]
  if (r && !busy.value && phase.value === 'how') void launch('how', i, r.choice)
}

function pickRoute(i: number) {
  const r = routeRows.value[i]
  if (r && !busy.value && phase.value === 'route') void launch('route', i, { kind: 'stop', station: r.station, route: r.route })
}

// ── 出發與導航 ───────────────────────────────────────
/**
 * 選好走法：先開始行程（要在點擊事件裡同步呼叫，iOS 才會給羅盤權限），
 * 再播滑動解鎖：箭頭從框外推到那一列的右邊界，亮色跟著尖端填滿；框淡出，箭頭放大滑回畫面中央。
 */
async function launch(s: StepName, i: number, choice: TripChoice) {
  trip.start(choice)
  const my = ++seq
  busy.value = true
  navigator.vibrate?.(12)
  if (i !== armRow) {
    await play([{ p: cur }, { p: pointPose(s, i) }], dur(T_MOVE), EASE_MOVE)
    if (my !== seq) return
    armRow = i
  }
  picked.value = i
  const box = boxEl(s, i)
  const b = box.getBoundingClientRect()
  const tip0 = cur.x + size / 2 + (pointBox() * K_POINT) / 2
  const tip1 = b.right - 4
  const t = dur(T_UNLOCK)
  const enter = Math.min(0.95, Math.max(0, (b.left - tip0) / (tip1 - tip0)))
  sweepAnim = box.querySelector<HTMLElement>('.sweep')?.animate(
    [
      { transform: 'scaleX(0)', opacity: 1, offset: 0 },
      { transform: 'scaleX(0)', opacity: 1, offset: enter },
      { transform: 'scaleX(1)', opacity: 1, offset: 1 },
    ],
    { duration: t, easing: EASE_UNLOCK, fill: 'forwards' },
  )
  await play([{ p: cur }, { p: { ...cur, x: cur.x + (tip1 - tip0) } }], t, EASE_UNLOCK)
  if (my !== seq) return
  void leaveStep(s, T_HOLD)
  await wait(dur(T_HOLD))
  if (my !== seq) return
  await flyToNav(my)
}

/** 元件退場、背景變暗後，讓箭頭獨留片刻，再放大轉向中心接上導航 */
async function flyToNav(my: number) {
  launchMoving.value = false
  phase.value = 'launch'
  await nextTick()
  await wait(dur(T_LAUNCH_PAUSE))
  if (my !== seq) return
  rot = cur.r - POINT_DEG
  navPose = navPoseNow()
  launchMoving.value = true
  await play([{ p: cur }, { p: navPose }], dur(T_LAUNCH), 'cubic-bezier(0.42, 0, 0.25, 1)')
  if (my !== seq) return
  busy.value = false
  target_ = rot
  phase.value = 'nav'
  const d = nav.view.value?.arrowDeg
  if (d !== null && d !== undefined) track(d)
}

/** 除錯工具：直接導航到示範站牌（市立臺北特教學校 203 往天母） */
async function demoTrip() {
  const st = DEFAULT_DESTINATION.station
  const r = DEFAULT_DESTINATION.stationRoute
  if (!st || !r || busy.value || phase.value !== 'search') return
  debugOpen.value = false
  trip.start({ kind: 'stop', station: st, route: r })
  const my = ++seq
  busy.value = true
  await closeKeyboard()
  void leaveStep('search', T_HOLD)
  await wait(dur(T_HOLD))
  if (my !== seq) return
  await flyToNav(my)
}

/** 回到搜尋：箭頭縮回搜尋欄左外側，搜尋欄再由左滑入 */
async function backToSearch(clearResults: boolean) {
  if (phase.value !== 'nav' && phase.value !== 'launch') return
  stopTrack()
  trip.end()
  if (clearResults) {
    query.value = ''
    search.clear()
  } else {
    void search.rerank()
  }
  search.clearBus()
  walkPlan.clear()
  const from: Pose = { ...navPose, r: rot }
  await enterStep('search', from)
}
const endNav = () => backToSearch(false)
const finish = () => backToSearch(true)

// 導航中的旋轉：目標角度一變就用 rAF 指數趨近（和實驗頁同一套 arrowTauMs），追到就停（不一直跑迴圈）
let target_ = 0
let raf = 0
let lastT = 0
function track(deg: number) {
  target_ += shortestDelta(target_, deg)
  if (!raf) {
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }
}
function frame(now: number) {
  rot = easeRotation(rot, target_, now - lastT, NAV_CONFIG.arrowTauMs)
  lastT = now
  heroArrow.value!.style.transform = innerT({ r: rot, k: K_NAV })
  raf = rot === target_ ? 0 : requestAnimationFrame(frame)
}
function stopTrack() {
  cancelAnimationFrame(raf)
  raf = 0
}

watch(
  () => nav.view.value,
  (v) => {
    if (phase.value !== 'nav' || !v) return
    if (v.state === 'arrived') track(0)
    else if (v.arrowDeg !== null) track(v.arrowDeg)
  },
)

// ── 語音與震動 ───────────────────────────────────────
const TURN_WORDS: TurnWordKey[] = ['left', 'right', 'slight_left', 'slight_right', 'uturn', 'stairs', 'cross']
const isTurnWord = (k: ManeuverKind | null | undefined): k is TurnWordKey => !!k && (TURN_WORDS as string[]).includes(k)
const turnWord = (k: ManeuverKind | null | undefined) => (isTurnWord(k) ? S.value.turn[k] : '')
/** 句首大寫（英文、越南文、印尼文的轉彎字是小寫） */
const cap = (t: string) => t.charAt(0).toLocaleUpperCase(lang.value) + t.slice(1)
const speechRate = computed(() => (audience.value === 'elder' ? 'slow' : 'normal') as 'slow' | 'normal')
const say = (text: string) => speakText(text, SPEECH_LANGS[lang.value], speechRate.value)

function cueText(c: Cue): string {
  const s = S.value
  switch (c.key) {
    case 'start':
      return s.cueStart
    case 'turn_ahead':
      if (c.turn === 'cross') return c.then && isTurnWord(c.then) ? fill(s.crossThen, { turn: turnWord(c.then) }) : s.crossNow
      return fill(s.cueTurnAhead, { turn: turnWord(c.turn) })
    case 'turn_around':
      return s.direction.turn_around
    case 'off_route':
      return s.cueOffRoute
    case 'weak_signal':
      return s.cueWeak
    case 'arrived':
      return A.value.arrived
  }
}

function onCue(c: Cue) {
  if (c.haptic && 'vibrate' in navigator) {
    navigator.vibrate(c.haptic === 'arrive' ? [200, 80, 200, 80, 400] : c.haptic === 'turn' ? [150] : [100, 60, 100])
  }
  // 抵達那句不出聲：到站畫面會自己念，走到目的地由下面的 watch 念
  if (c.speak) say(cueText(c))
}

const arrivedHeadline = computed(() => (audience.value === 'child' ? A.value.arrivedChild : A.value.arrived))
watch(
  () => trip.finalArrived.value,
  (yes) => {
    if (yes) say(`${arrivedHeadline.value} ${fill(S.value.arrivedHere, { name: trip.finalName.value })}`)
  },
)

// ── 導航畫面文字 ─────────────────────────────────────
const TURN_DEG: Record<TurnWordKey, number> = {
  left: -90,
  right: 90,
  slight_left: -45,
  slight_right: 45,
  uturn: 180,
  stairs: 0,
  cross: 0,
}
const DIR_DEG = { straight: 0, bear_left: -45, bear_right: 45, left: -90, right: 90, turn_around: 180 } as const

const view = computed(() => nav.view.value)
const navArrived = computed(() => trip.finalArrived.value)
const tone = computed(() => {
  const v = view.value
  if (navArrived.value || v?.state === 'arrived') return 'arrived'
  if (!v || v.state === 'locating' || v.state === 'routing' || v.state === 'failed') return 'idle'
  if (v.state === 'navigating' && !v.headingLost) return 'go'
  return 'warn'
})
/** 箭頭空心：訊號弱、重新找路、還沒有方向（找位置、找路、抓不到方向） */
const hollow = computed(() => {
  const v = view.value
  if (!v) return true
  if (v.state === 'arrived') return false
  return v.hollowArrow || v.headingLost || v.arrowDeg === null
})
/** 等待中：箭頭呼吸（搜尋中、算公車中、找位置、找路） */
const waiting = computed(() => {
  if (phase.value === 'search') return search.searching.value
  if (phase.value === 'nav') {
    const st = view.value?.state
    return !view.value || st === 'locating' || st === 'routing'
  }
  return false
})
const done = computed(() => navArrived.value && phase.value === 'nav')
/** 箭頭停在清單或搜尋欄旁、沒有過場 → 版面變動時讓它滑過去不跳 */
const settled = computed(() => !busy.value && isStep(phase.value))

/** 下一個轉彎的路名（轉進哪一條路） */
function streetOf(index: number, kind: ManeuverKind): string {
  return nav.routeInfo.value?.maneuvers.find((m) => m.atIndex === index && m.kind === kind)?.street ?? ''
}

const hint = computed(() => {
  const s = S.value
  const v = view.value
  if (navArrived.value) return { deg: 0, main: arrivedHeadline.value, sub: trip.finalName.value }
  if (!v) return { deg: 0, main: s.locating, sub: s.waitSub }
  switch (v.state) {
    case 'locating':
      return { deg: 0, main: s.locating, sub: s.waitSub }
    case 'routing':
      return { deg: 0, main: s.routing, sub: s.waitSub }
    case 'weak_signal':
      return { deg: 0, main: s.weak, sub: s.weakSub }
    case 'rerouting':
      return { deg: 0, main: s.rerouting, sub: s.reroutingSub }
    case 'failed':
      return {
        deg: 0,
        main: v.failReason === 'location_denied' ? s.failDenied : v.failReason === 'route_failed' ? s.failRoute : s.failOff,
        sub: s.failSub,
      }
    case 'arrived':
      return { deg: 0, main: A.value.arrived, sub: nav.active.value?.name ?? '' }
  }
  if (v.headingLost) return { deg: 0, main: s.headingLost, sub: s.headingLostSub }
  if (v.state === 'back_to_route') return { deg: 0, main: s.backToRoute, sub: fill(s.backToRouteSub, { d: distanceWords(v.distanceM, lang.value) }) }

  const t = v.nextTurn
  if (t && isTurnWord(t.kind)) {
    const ahead = t.kind === 'cross' ? (t.startM ?? t.distanceM) : t.distanceM
    const street = streetOf(t.index, t.kind)
    const thenTurn = t.kind === 'cross' && isTurnWord(t.then) ? t.then : null
    const deg = TURN_DEG[thenTurn ?? t.kind]
    if (ahead <= 30) {
      const main =
        t.kind === 'cross'
          ? thenTurn
            ? fill(s.crossThen, { turn: turnWord(thenTurn) })
            : s.crossNow
          : fill(s.turnNow, { turn: turnWord(t.kind) })
      return { deg, main, sub: street }
    }
    if (ahead <= 150) {
      return { deg, main: cap(turnWord(t.kind)), sub: [distanceWords(ahead, lang.value), street].filter(Boolean).join(' · ') }
    }
  }
  const dir = v.direction ?? 'straight'
  return {
    deg: DIR_DEG[dir],
    main: s.direction[dir],
    sub:
      t && isTurnWord(t.kind)
        ? fill(s.turnIn, { d: distanceWords(t.kind === 'cross' ? (t.startM ?? t.distanceM) : t.distanceM, lang.value), turn: turnWord(t.kind) })
        : fill(s.toGo, { d: distanceWords(v.distanceM, lang.value) }),
  }
})

/** 這一段要去哪：去公車站時寫「走到 ○○ 搭 203」 */
const destLine = computed(() => {
  const a = nav.active.value
  if (!a) return ''
  if (a.station && a.stationRoute) return fill(S.value.walkToStop, { stop: nameOf(a.station.name), route: nameOf(a.stationRoute.routeName) })
  return a.name
})

/** 剩餘距離：只在沿路線走的時候更新（back_to_route 的距離是離路線多遠，不能拿來算） */
const remainingM = ref<number | null>(null)
watch(view, (v) => {
  if (!v) remainingM.value = null
  else if (v.state === 'navigating' && v.distanceM !== null) remainingM.value = v.distanceM
})
/** 約幾分鐘：用這條路線自己的速度（和「怎麼去」列的時間一致；長者 3.5 km/h），沒有路線時長者走慢一點 */
const minutes = computed(() => {
  if (remainingM.value === null) return null
  const r = nav.routeInfo.value
  const perMin = r && r.durationS > 0 && r.distanceM > 0 ? (r.distanceM / r.durationS) * 60 : audience.value === 'elder' ? 55 : 67
  return Math.max(1, Math.round(remainingM.value / perMin))
})
const showRecal = computed(() => {
  const v = view.value
  return !!v && !navArrived.value && v.state !== 'arrived' && v.state !== 'failed' && (v.headingLost || v.headingCheck === 'suspect')
})
const failed = computed(() => view.value?.state === 'failed' && !navArrived.value)

// 報讀只在「說法」變的時候更新，不跟著距離刷新
const announce = computed(() => (phase.value === 'nav' && !trip.card.value ? hint.value.main : ''))

// ── 標語：logo 落定後打字機打出「一鍵成行」，停一下再進下一步 ─────
const BRAND = '一鍵成行'
const typed = ref(0)
let typeTimer: ReturnType<typeof setInterval> | undefined
let flowTimer: ReturnType<typeof setTimeout> | undefined
function typeBrand() {
  clearInterval(typeTimer)
  clearTimeout(flowTimer)
  if (reducedMotion()) {
    typed.value = BRAND.length
    flowTimer = setTimeout(startSetup, 400)
    return
  }
  typed.value = 0
  typeTimer = setInterval(() => {
    if (++typed.value < BRAND.length) return
    clearInterval(typeTimer)
    flowTimer = setTimeout(startSetup, 650)
  }, 170)
}
watch(phase, (p) => {
  if (p === 'brand') typeBrand()
})

// ── 開場 ─────────────────────────────────────────────
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2)

/**
 * 開場影格：用數學曲線逐格取樣（每格之間線性），速度全程連續，不會有「停一下再動」的頓感。
 * - 轉圈：-30° → 405°（easeInOutCubic），轉到最後時重摔已經開始。
 * - 大小：0.9 → 1.36 慢慢抬起（easeOutCubic，到頂速度剛好是 0），
 *   接著用阻尼彈簧從頂點落下：一開始慢、越掉越快，壓過頭到 ~0.92 再彈回 1。
 */
function introFrames(end: Pose): Frame[] {
  const N = 96
  const ROT_END = 0.64 // 轉圈結束
  const PEAK = 0.56 // 抬到最高、開始往下摔
  const LIFT = 0.36
  const zeta = 0.42 // 阻尼比：壓過頭約 23%
  const fallS = ((1 - PEAK) * T_INTRO) / 1000
  const omega = 4.6 / (zeta * fallS) // 摔完時殘留 < 1%
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  const spring = (tau: number) =>
    Math.exp(-zeta * omega * tau) * (Math.cos(wd * tau) + ((zeta * omega) / wd) * Math.sin(wd * tau))
  const r0 = -30
  const r1 = 360 + LOGO_DEG
  const frames: Frame[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const k = t <= PEAK ? 0.9 + (1 + LIFT - 0.9) * easeOutCubic(t / PEAK) : 1 + LIFT * spring(((t - PEAK) * T_INTRO) / 1000)
    const r = r0 + (r1 - r0) * easeInOutCubic(Math.min(1, t / ROT_END))
    frames.push({ p: { ...end, s: end.s * k, r }, opacity: Math.min(1, t / 0.1), offset: t })
  }
  frames[N] = { p: end, offset: 1 }
  return frames
}

async function intro() {
  const my = ++seq
  await nextTick()
  const end = logoPose(360 + LOGO_DEG)
  if (reducedMotion()) {
    setHero(end)
    hero.value!.style.opacity = '1'
    phase.value = 'brand'
    return
  }
  await play(introFrames(end), T_INTRO)
  if (my !== seq) return
  phase.value = 'brand'
}

/** 打完標語：標語上移，第一次用就進語言清單，否則直接到搜尋；開始持續定位（不在開場時跳權限視窗） */
async function startSetup() {
  if (phase.value !== 'brand') return
  clearInterval(typeTimer)
  clearTimeout(flowTimer)
  typed.value = BRAND.length
  phase.value = needSetup ? 'lang' : 'search'
  updateLift()
  await enterStep(needSetup ? 'lang' : 'search', cur, EASE_LIFT)
  // 箭頭落定後才開始定位：權限視窗、GPS 啟動不會卡在箭頭飛過去的途中
  locator.start()
}

/** 點一下畫面：跳過開場；標語還在打就直接打完、進下一步 */
function skipIntro() {
  if (phase.value === 'intro') anims.forEach((a) => a.finish())
  else if (phase.value === 'brand') void startSetup()
}

/** 標語滑到頂端（對齊 .dock 的位置） */
function updateLift() {
  if (!titleEl.value || !dock.value) return
  const natural = titleEl.value.getBoundingClientRect().top - lift.value
  lift.value = dock.value.getBoundingClientRect().top - natural
}

// ── 隱藏的除錯按鈕：長按 0.7 秒 ─────────────────────
let pressTimer: ReturnType<typeof setTimeout> | undefined
function pressStart() {
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    navigator.vibrate?.(20)
    debugOpen.value = true
  }, 700)
}
const pressEnd = () => clearTimeout(pressTimer)
function secretKey(e: MouseEvent) {
  if (e.detail === 0) debugOpen.value = true // 鍵盤 Enter／空白鍵
}

// 除錯面板打開時導航箭頭往上挪，面板不擋箭頭（才看得到搖桿的效果）
watch(debugOpen, async () => {
  if (phase.value !== 'nav') return
  await nextTick()
  const from = { ...navPose, r: rot }
  navPose = navPoseNow()
  await play([{ p: from, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' }, { p: { ...navPose, r: rot } }], 360)
})

// ── 版面變動（轉向、鍵盤、清單捲動、結果出來） ─────────
let resizeRaf = 0
function onResize() {
  cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    const resized = measure()
    if (anims.length) return // 過場中不打斷；過場結束時的位置是量出來的
    // 方塊大小變了（--hero 立刻生效）：位置也要同一格到位，不能用 .settled 的過渡慢慢滑，不然箭頭會抽一下
    if (resized) {
      hero.value!.style.transition = 'none'
      requestAnimationFrame(() => hero.value && (hero.value.style.transition = ''))
    }
    const p = phase.value
    if (p !== 'intro' && p !== 'brand') updateLift()
    if (p === 'brand') setHero(logoPose(cur.r))
    else if (isStep(p) && steps[p] === 'in') setHero(pointPose(p, armRow))
    else if (p === 'nav') {
      navPose = navPoseNow()
      setHero({ ...navPose, r: rot })
    }
  })
}
// 清單內容變了（結果、公車、語言、搜尋中的轉圈），版面跟著變 → 箭頭重新對準
// （搜尋步驟整組垂直置中：轉圈出現時搜尋欄會往上移，沒跟著重算箭頭就會掉在搜尋欄下面）
watch([rows, howRows, howNote, routeNote, searchNote, lang, age, mode, search.searching], () => void nextTick(onResize))

onMounted(() => {
  document.title = '跟著箭頭走'
  measure()
  if (params.has('debug')) debugOpen.value = true
  window.addEventListener('resize', onResize)
  intro()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  locator.stop()
  stopTrack()
  anims.forEach((a) => a.cancel())
  sweepAnim?.cancel()
  clearTimeout(pressTimer)
  clearInterval(typeTimer)
  clearTimeout(flowTimer)
})
</script>

<template>
  <div
    ref="root"
    class="av"
    :class="[`is-${phase}`, `tone-${tone}`, { 'dbg-on': debugOpen, settled, waiting }]"
    :lang="lang"
    :style="{ '--fs': FONT_SCALE[age] }"
    @pointerdown.capture="skipIntro"
  >
    <!-- 背景是單色（.av 的 background-color）：首頁深色，導航換成狀態色，只做顏色過渡 -->

    <!-- 開場：logo＋標語整組在畫面正中央（共用箭頭疊在 logo-slot 上）；之後標語滑到頂端 -->
    <main class="home">
      <h1 class="sr-only">跟著箭頭走 · 一鍵成行</h1>
      <div class="stack">
        <div ref="logoSlot" class="logo-slot" />
        <!-- 隱形的整句撐住寬度，打出來的字疊在上面從左邊開始 → 置中但不會邊打邊跳 -->
        <p ref="titleEl" class="title brand-text" lang="zh-TW" aria-hidden="true" :style="{ '--lift': `${lift}px` }">
          <span class="ask-ghost">{{ BRAND }}</span>
          <span class="ask-typed">{{ BRAND.slice(0, typed) }}<i class="caret" :class="{ off: typed >= BRAND.length }" /></span>
        </p>
      </div>
    </main>

    <!-- 設定步驟：語言 → 年紀 → 搜尋 → 怎麼去／要搭哪一班，同一個位置輪流由左滑入。
         上下各放一個和標語等高的 .dock → 中間的操作區剛好落在畫面正中央 -->
    <div class="setup">
      <p ref="dock" class="dock brand-text" aria-hidden="true">{{ BRAND }}</p>
      <div ref="stepsEl" class="steps">
        <!-- 語言（還沒選語言，標題中英並列） -->
        <section class="step" :class="`st-${steps.lang}`" data-step="lang" :inert="steps.lang !== 'in'" aria-labelledby="h-lang">
          <div class="step-body">
            <h2 id="h-lang" class="step-h" lang="zh-TW">選擇語言<span class="step-sub" lang="en">Language</span></h2>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(item, i) in LANG_ITEMS" :key="item.id">
                <button type="button" class="row" :class="{ picked: phase === 'lang' && picked === i }" :data-i="i" :lang="item.id" @click="pickLang(i)">
                  <span class="row-label">{{ item.label }}</span>
                </button>
              </li>
            </ul>
          </div>
        </section>

        <!-- 誰要使用 -->
        <section class="step" :class="`st-${steps.age}`" data-step="age" :inert="steps.age !== 'in'" aria-labelledby="h-age">
          <div class="step-body">
            <h2 id="h-age" class="step-h">{{ S.ageTitle }}</h2>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(key, i) in AGE_ITEMS" :key="key">
                <button type="button" class="row" :class="{ picked: phase === 'age' && picked === i }" :data-i="i" @click="pickAge(i)">
                  <span class="row-label">{{ S.ages[key] }}</span>
                </button>
              </li>
            </ul>
          </div>
        </section>

        <!-- 路線模式：快速／安全／平緩（依年紀建議一個） -->
        <section class="step" :class="`st-${steps.mode}`" data-step="mode" :inert="steps.mode !== 'in'" aria-labelledby="h-mode">
          <div class="step-body">
            <h2 id="h-mode" class="step-h">{{ R.modeTitle }}</h2>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(key, i) in MODE_ITEMS" :key="key">
                <button type="button" class="row" :class="{ picked: phase === 'mode' && picked === i }" :data-i="i" @click="pickMode(i)">
                  <span class="row-label">{{ R.modes[key] }}</span>
                </button>
              </li>
            </ul>
          </div>
        </section>

        <!-- 搜尋＋結果 -->
        <section class="step" :class="`st-${steps.search}`" data-step="search" :inert="steps.search !== 'in'" aria-labelledby="h-search">
          <div class="step-body" :class="{ grow: hasResults || searchNote }">
            <div class="step-top">
              <h2 id="h-search" class="step-h">{{ S.searchTitle }}</h2>
              <button type="button" class="pill" :aria-label="S.change" @click="changeSettings">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" /></svg>
                <span>{{ langLabel }} · {{ S.ages[age] }} · {{ R.modes[mode] }}</span>
              </button>
            </div>
            <form class="search" role="search" @submit.prevent="submitSearch">
              <span class="sweep" aria-hidden="true" />
              <label for="dest" class="sr-only">{{ S.searchTitle }}</label>
              <input
                id="dest"
                ref="input"
                v-model="query"
                type="search"
                enterkeyhint="search"
                autocomplete="off"
                :placeholder="S.placeholder"
                @focus="onSearchFocus"
              />
              <button type="submit" class="find" :disabled="!query.trim() || search.searching.value" :aria-label="search.searching.value ? S.searching : S.search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M15.5 15.5L20.5 20.5" />
                </svg>
              </button>
            </form>
            <div v-if="search.searching.value" class="search-spinner" role="status" :aria-label="S.searching"></div>
            <p v-if="searchNote" class="note warn" role="status">{{ searchNote }}</p>
            <!-- 外語搜尋：讓使用者看到用什麼中文搜的（즈산역 → 芝山站）；有其他可能就給按鈕 -->
            <div v-if="search.translation.value && !search.searching.value" class="note translated" aria-live="polite">
              <span>{{ search.translation.value.from }} → </span>
              <b v-if="search.translation.value.to" lang="zh-TW">{{ search.translation.value.to }}</b>
              <span v-else>?</span>
              <button
                v-for="alt in search.translation.value.alternatives"
                :key="alt"
                type="button"
                class="alt"
                lang="zh-TW"
                @click="searchAlt(alt)"
              >
                {{ alt }}
              </button>
            </div>
            <ul v-if="hasResults && !search.searching.value" class="list results" @scroll.passive="onResize">
              <template v-for="(r, i) in rows" :key="r.key">
                <li v-if="r.type === 'hit' && r.head" class="group-h" aria-hidden="true">{{ r.head }}</li>
                <li>
                  <button
                    v-if="r.type === 'hit'"
                    type="button"
                    class="row tall"
                    :class="{ picked: phase === 'search' && picked === i }"
                    :data-i="i"
                    @click="pickResult(i)"
                  >
                    <span class="row-ico" :class="`k-${r.kind}`" aria-hidden="true">
                      <svg v-if="r.kind === 'stop'" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="13" rx="2.5" /><path d="M6 11h12M9 16v3M15 16v3M9 7h6" /></svg>
                      <svg v-else-if="r.kind === 'poi'" viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
                      <svg v-else viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
                    </span>
                    <span class="row-text">
                      <span class="row-main">{{ r.name }}</span>
                      <span v-if="r.zh" class="row-zh" lang="zh-TW">{{ r.zh }}</span>
                    </span>
                    <span v-if="r.dist !== null" class="row-right">{{ listDistance(r.dist) }}</span>
                  </button>
                  <button v-else type="button" class="row more" @click="showMore(r)">{{ S.more }}（{{ r.left }}）</button>
                </li>
              </template>
              <li class="src">{{ sourceLine }}</li>
            </ul>
          </div>
        </section>

        <!-- 怎麼去：走路或公車 -->
        <section class="step" :class="`st-${steps.how}`" data-step="how" :inert="steps.how !== 'in'" aria-labelledby="h-how">
          <div class="step-body">
            <div class="step-top">
              <button type="button" class="back" :aria-label="S.back" @click="back('how')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
              <h2 id="h-how" class="step-h">
                {{ S.howTitle }}<span class="step-sub">{{ target?.name }}</span>
              </h2>
            </div>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(r, i) in howRows" :key="r.key">
                <button type="button" class="row tall" :class="{ picked: phase === 'how' && picked === i }" :data-i="i" @click="pickHow(i)">
                  <span class="sweep" aria-hidden="true" />
                  <span class="row-ico" :class="r.choice.kind === 'bus' ? 'k-stop' : 'k-walk'" aria-hidden="true">
                    <svg v-if="r.choice.kind === 'bus'" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="13" rx="2.5" /><path d="M6 11h12M9 16v3M15 16v3M9 7h6" /></svg>
                    <svg v-else viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6 3 3v3M9 12l1.5-4.5L14 9l2 3M12 15l-1.5-7.5" /></svg>
                  </span>
                  <span class="row-text">
                    <span class="row-main">{{ r.title }}</span>
                  </span>
                  <span v-if="r.right" class="row-right">{{ r.right }}</span>
                </button>
              </li>
            </ul>
            <p v-if="routeNote" class="note" :class="{ warn: walkPlan.plan.value?.fallback }" role="status">{{ routeNote }}</p>
            <p v-if="howNote" class="note" :class="{ warn: !search.busLoading.value }" role="status">{{ howNote }}</p>
          </div>
        </section>

        <!-- 公車站：要搭哪一班 -->
        <section class="step" :class="`st-${steps.route}`" data-step="route" :inert="steps.route !== 'in'" aria-labelledby="h-route">
          <div class="step-body">
            <div class="step-top">
              <button type="button" class="back" :aria-label="S.back" @click="back('route')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
              <h2 id="h-route" class="step-h">
                {{ S.routeTitle }}<span v-if="stopGroup" class="step-sub">{{ nameOf(stopGroup.name) }}<template v-if="stationFacing"> · {{ stationFacing }}</template></span>
              </h2>
            </div>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(r, i) in routeRows" :key="r.route.stopUid">
                <button type="button" class="row" :class="{ picked: phase === 'route' && picked === i }" :data-i="i" @click="pickRoute(i)">
                  <span class="sweep" aria-hidden="true" />
                  <span class="row-label"><b class="route-no">{{ nameOf(r.route.routeName) }}</b> {{ nameOf(r.route.headsign) }}</span>
                </button>
              </li>
            </ul>
            <p v-if="stopGroup && !routeRows.length" class="note warn">{{ S.noResult }}</p>
          </div>
        </section>
      </div>
      <p class="dock brand-text" aria-hidden="true">{{ BRAND }}</p>
    </div>

    <!-- 導航：上方目的地與提示、中央箭頭（共用箭頭疊在 nav-slot 上）、下方距離與結束 -->
    <section class="nav" :inert="phase !== 'nav' || !!trip.card.value" :aria-label="S.end">
      <p class="dest">
        <span v-if="nav.simGps.value" class="sim-badge" lang="zh-TW">模擬</span>{{ destLine }}
      </p>
      <div class="hint">
        <span class="hint-ico" :style="{ transform: `rotate(${hint.deg}deg)` }">
          <ArrowMark navigation :hollow="hollow && !navArrived" :done="navArrived" />
        </span>
        <div class="hint-text">
          <p class="hint-main">{{ hint.main }}</p>
          <p v-if="hint.sub" class="hint-sub">{{ hint.sub }}</p>
        </div>
      </div>
      <div v-if="showRecal" class="recal">
        <p v-if="view?.headingCheck === 'suspect' && !view?.headingLost" class="recal-note">{{ S.suspect }}</p>
        <button type="button" class="glass pill-btn" @click="nav.recalibrate('manual')">{{ S.recalibrate }}</button>
      </div>

      <div class="nav-mid">
        <div ref="navSlot" class="nav-slot" />
        <div v-if="!navArrived && !failed" class="eta">
          <template v-if="remainingM !== null">
            <p>{{ fill(S.remaining, { d: distanceWords(remainingM, lang) }) }}</p>
            <p class="eta-minutes">{{ fill(S.aboutMin, { min: minutes ?? 1 }) }}</p>
          </template>
          <template v-else><p>—</p><p class="eta-minutes" aria-hidden="true">&nbsp;</p></template>
        </div>
      </div>

      <div class="foot">
        <button v-if="navArrived" type="button" class="glass end" @click="finish">{{ A.done }}</button>
        <template v-else-if="failed">
          <button type="button" class="glass end retry" @click="nav.restart()">{{ S.retry }}</button>
          <button type="button" class="glass end" @click="endNav">{{ S.end }}</button>
        </template>
        <button v-else type="button" class="glass end" @click="endNav">{{ S.end }}</button>
      </div>
    </section>
    <p class="sr-only" aria-live="polite">{{ announce }}</p>

    <!-- 共用箭頭：外層管位置大小，內層箭頭管角度 -->
    <div ref="hero" class="hero" aria-hidden="true">
      <div ref="heroArrow" class="hero-arrow">
        <ArrowMark :navigation="phase === 'nav' || (phase === 'launch' && launchMoving)" :hollow="hollow && phase === 'nav'" :done="done" />
      </div>
    </div>

    <!-- 行程中的到站、坐車、只到站牌：蓋在導航上，不跳頁，行程才不會中斷 -->
    <Transition name="card">
      <div v-if="phase === 'nav' && trip.card.value && trip.cardTrip.value" class="card-layer">
        <ArrivalCard
          v-if="trip.card.value === 'at_stop'"
          key="at_stop"
          :trip="trip.cardTrip.value"
          :lang="lang"
          :audience="audience"
          :primary-label="A.boarded"
          @primary="trip.onBoarded"
        />
        <RideCard
          v-else-if="trip.card.value === 'ride'"
          key="ride"
          :trip="trip.cardTrip.value"
          :lang="lang"
          :audience="audience"
          :status="trip.rideNow.value"
          :simulate="nav.simGps.value"
          @got-off="trip.onGotOff"
          @sim-next="trip.simNextStop"
        />
        <ArrivalCard
          v-else
          key="stop_only"
          :trip="trip.cardTrip.value"
          :lang="lang"
          :audience="audience"
          :primary-label="A.done"
          @primary="finish"
        />
      </div>
    </Transition>

    <!-- 隱藏按鈕：右上角看不見，長按 0.7 秒開除錯工具 -->
    <button
      type="button"
      class="secret"
      aria-label="開發者除錯工具（長按）"
      @pointerdown="pressStart"
      @pointerup="pressEnd"
      @pointercancel="pressEnd"
      @pointerleave="pressEnd"
      @contextmenu.prevent
      @click="secretKey"
    />

    <DebugSheet v-if="debugOpen" :trip="trip" :can-demo="phase === 'search' && !busy" @close="debugOpen = false" @demo="demoTrip" />
  </div>
</template>

<style scoped>
.av {
  --ink: #f1f3f4;
  --ink-2: rgb(241 243 244 / 0.72);
  --arc: #93d4df;
  --note-warn: #f4d69e;
  /* 霧化玻璃元件：半透明白＋細邊，上緣亮一點（不用陰影、不用 backdrop-filter） */
  --glass: rgb(255 255 255 / 0.08);
  --glass-edge: rgb(255 255 255 / 0.14);
  --glass-rim: rgb(255 255 255 / 0.3);
  /* 前面的步驟（清單、搜尋欄、右上膠囊）：城市通 TPColors 實色，不用玻璃 */
  --surface: #22474e; /* primary800 */
  --surface-press: #356c77; /* primary700 */
  --surface-picked: #468d9b; /* primary600 */
  --idle: #30383d;
  /* 城市通 TPColors：primary600／primary700（白字對比 ≥ 3:1，primary500 太亮） */
  --go: #468d9b;
  --warn: #74521b;
  --arrived: #356c77;
  --ease-out: cubic-bezier(0.2, 0.9, 0.1, 1);
  /* 對象的字級倍率（長者 1.2、兒童 1.1） */
  --fs: 1;
  /* 清單、搜尋欄左邊留給箭頭的空間（箭頭在框外）；右邊少留一點讓整組看起來置中 */
  --point-gutter: 44px;
  position: relative;
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  color: var(--ink);
  /* 單色背景：首頁深色；導航換成規格的狀態色 */
  background-color: #112629; /* TPColors.primary900 */
  transition: background-color 0.6s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.is-launch,
.is-nav {
  background-color: var(--go);
}
.is-launch.tone-idle,
.is-nav.tone-idle {
  background-color: var(--idle);
}
.is-launch.tone-warn,
.is-nav.tone-warn {
  background-color: var(--warn);
}
.is-launch.tone-arrived,
.is-nav.tone-arrived {
  background-color: var(--arrived);
}

/* ── 開場：logo＋標語整組置中 ─────── */
.home {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 0 16px;
  pointer-events: none;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.logo-slot {
  width: 160px;
  height: 160px;
}
.brand-text {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.08em;
}
.title {
  position: relative;
  margin-top: 20px;
  /* letter-spacing 在最後一個字後面也留了空：吃掉它，文字的視覺中線才會對準箭頭 */
  margin-right: -0.08em;
  color: var(--ink);
  transform: translate3d(0, 0, 0);
  transition:
    transform 0.62s var(--ease-out),
    opacity 0.3s ease;
}
/* 進入設定步驟後滑到頂端（位置由 .dock 量出來） */
.av:not(.is-intro):not(.is-brand) .title {
  transform: translate3d(0, var(--lift), 0);
}
/* 開場時不出現游標；導航時標語淡出 */
.is-intro .title {
  visibility: hidden;
}
.is-launch .title,
.is-nav .title {
  opacity: 0;
}
.ask-ghost {
  visibility: hidden;
}
.ask-typed {
  position: absolute;
  inset: 0 auto 0 0;
  white-space: nowrap;
}
.caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 3px;
  vertical-align: -0.12em;
  background: var(--arc);
  animation: blink 1s steps(1) infinite;
  transition: opacity 0.3s ease;
}
.caret.off {
  opacity: 0;
  animation: none;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* ── 設定步驟：頂端標語＋中間操作區（上下對稱 → 在畫面正中央） ─────── */
.setup {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: calc(24px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
  pointer-events: none;
}
.dock {
  flex: none;
  visibility: hidden;
}
.steps {
  position: relative;
  flex: 1;
  width: 100%;
  max-width: 460px;
  min-height: 0;
  margin: 16px 0;
}
/* 平常停在左邊畫面外；.st-in 由左滑入；.st-out 原地淡出；回到 .st-off 時瞬間歸位 */
.step {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 0 calc(var(--point-gutter) - 28px) 0 var(--point-gutter);
  visibility: hidden;
  opacity: 0;
  transform: translate3d(calc(-100% - 16px), 0, 0);
  pointer-events: none;
}
.step.st-in {
  visibility: visible;
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition:
    transform 0.62s var(--ease-out),
    opacity 0.3s ease;
}
.step.st-out {
  visibility: visible;
  opacity: 0;
  transform: none;
  transition: opacity 0.25s ease;
}
/* 選好走法時框淡出慢一點：箭頭停在右邊界時框慢慢消失 */
.step.st-out[data-step='search'],
.step.st-out[data-step='how'],
.step.st-out[data-step='route'] {
  transition: opacity 0.38s ease;
}
/* 內容垂直置中；放不下時 margin 變 0，清單自己捲動 */
.step-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
  margin: auto 0;
}
/* 有搜尋結果：搜尋欄移到頂端，結果填滿下方 */
.step-body.grow {
  height: 100%;
  margin: 0;
}
.step-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
.step-top .step-h {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.step-h {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 10px;
  margin: 0 0 12px 2px;
  font-size: calc(18px * var(--fs));
  font-weight: 700;
  color: var(--ink);
}
.step-sub {
  min-width: 0;
  font-size: calc(15px * var(--fs));
  font-weight: 500;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
/* 右上角的小膠囊（語言 · 使用者）與返回鈕：同一套玻璃 */
.pill,
.back {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  max-width: 55%;
}
.pill span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.back {
  width: 40px;
  height: 40px;
  padding: 0;
  justify-content: center;
  color: var(--ink);
}
.pill svg,
.back svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.back svg {
  width: 20px;
  height: 20px;
  stroke-width: 2.4;
}
.pill:active,
.back:active {
  background: var(--surface-press);
}
.pill:focus-visible,
.back:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: 2px;
}
.note {
  margin: 10px 2px 0;
  font-size: calc(15px * var(--fs));
  line-height: 1.45;
  color: var(--ink-2);
}
.note.warn {
  color: var(--note-warn);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: 2px 0 4px;
}
.list.results {
  flex: 1;
  margin-top: 8px;
}
.group-h {
  margin: 8px 2px 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-2);
}
.group-h:first-child {
  margin-top: 0;
}
.src {
  margin: 10px 2px 4px;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(241 243 244 / 0.5);
}
.row {
  position: relative;
  width: 100%;
  min-height: calc(50px * var(--fs));
  padding-block: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid transparent;
  color: var(--ink);
  font-size: calc(18px * var(--fs));
  font-weight: 600;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}
/* 兩行的列（搜尋結果、怎麼去）：名稱＋說明，右邊距離或時間 */
.row.tall {
  height: auto;
  min-height: calc(60px * var(--fs));
  padding: 10px 14px;
}
.row.more {
  justify-content: center;
  height: calc(44px * var(--fs));
  font-size: calc(15px * var(--fs));
  color: var(--ink-2);
}
.row-label,
.row-text,
.row-ico,
.row-right {
  position: relative; /* 疊在 .sweep 上面 */
}
.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-main {
  font-size: calc(17px * var(--fs));
  font-weight: 700;
  line-height: 1.3;
}
/* 外語介面：名稱下面附中文原名，對得上招牌 */
.row-zh {
  font-size: calc(15px * var(--fs));
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink-2);
}
.note.translated {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.note.translated .alt {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: inherit;
}
.row-right {
  flex: none;
  align-self: center;
  font-size: calc(14px * var(--fs));
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.row-ico {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.1);
  color: var(--ink);
}
.row-ico.k-stop {
  background: rgb(147 212 223 / 0.2);
  color: var(--arc);
}
.row-ico.k-poi {
  background: rgb(244 214 158 / 0.18);
  color: var(--note-warn);
}
.row-ico svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.route-no {
  margin-right: 6px;
  font-size: calc(20px * var(--fs));
  font-weight: 800;
}
.row:active {
  background: var(--surface-press);
}
/* 被點的那列：亮起來（箭頭戳下去的同時） */
.row.picked {
  background: var(--surface-picked);
  border-color: var(--arc);
}
.row:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: 2px;
}

/* 搜尋欄：細一點，右端是放大鏡 */
.search {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(48px * var(--fs));
  padding: 0 4px 0 16px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid transparent;
}
.search:focus-within {
  border-color: var(--arc);
}
.search-spinner {
  width: 24px;
  height: 24px;
  margin: 20px auto;
  border: 3px solid rgb(255 255 255 / 0.25);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: search-spin 0.8s linear infinite;
}
@keyframes search-spin {
  to { transform: rotate(360deg); }
}
/* 選好走法時亮色跟著箭頭從左填到右（滑動解鎖） */
.sweep {
  position: absolute;
  inset: 0;
  background: rgb(147 212 223 / 0.28);
  transform-origin: 0 50%;
  transform: scaleX(0);
  opacity: 0;
  pointer-events: none;
}
.search input {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  font-size: calc(17px * var(--fs));
  color: var(--ink);
  outline: none;
  user-select: text;
  -webkit-user-select: text;
}
.search input::placeholder {
  color: var(--ink-2);
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.find {
  position: relative;
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: #0d1214;
  background: #f1f3f4;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    background-color 0.2s ease,
    color 0.2s ease;
}
.find:active {
  transform: scale(0.94);
}
.find:disabled {
  color: var(--ink-2);
  background: transparent;
  cursor: default;
}
.find:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: -3px;
}
.find svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
}

/* ── 導航 ─────────────────────────── */
.nav {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));
  color: #fff;
}
/* 液態玻璃：首頁搜尋欄與導航的提示、按鈕同一套（半透明白＋上緣亮邊，不用陰影、不用 backdrop-filter） */
.glass {
  border-radius: 20px;
  background: var(--glass);
  border: 1px solid var(--glass-edge);
  border-top-color: var(--glass-rim);
}
.dest {
  min-height: 1.4em;
  margin: 0 4px 8px;
  font-size: calc(17px * var(--fs));
  font-weight: 600;
  line-height: 1.4;
  opacity: 0;
  overflow-wrap: anywhere;
  transition: opacity 0.2s ease;
}
.hint {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 92px;
  padding: 14px 20px;
  opacity: 0;
  transform: translateY(-18px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.hint-ico {
  flex: none;
  width: 44px;
  height: 44px;
  transition: transform 0.4s var(--ease-out);
}
.hint-text {
  min-width: 0;
}
.hint-main {
  font-size: calc(30px * var(--fs));
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}
.hint-sub {
  margin-top: 2px;
  font-size: calc(18px * var(--fs));
  line-height: 1.4;
  opacity: 0.92;
  overflow-wrap: anywhere;
}
.recal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  text-align: center;
}
.recal-note {
  font-size: calc(16px * var(--fs));
  line-height: 1.4;
}
.pill-btn {
  min-height: 48px;
  padding: 0 22px;
  font-size: calc(17px * var(--fs));
  font-weight: 700;
  cursor: pointer;
}
.nav-mid {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.dbg-on .nav-mid {
  padding-bottom: 300px;
}
.nav-slot {
  position: relative;
  flex: none;
  width: var(--hero, 240px);
  height: var(--hero, 240px);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  align-items: stretch;
  min-height: 64px;
  opacity: 0;
  transform: translateY(18px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.eta {
  flex: none;
  margin-top: 28px;
  text-align: center;
  font-size: calc(26px * var(--fs));
  line-height: 1.25;
  font-weight: 400;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 0.45s ease;
}
.eta-minutes {
  margin-top: 8px;
  opacity: 0.85;
}
.end {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: calc(20px * var(--fs));
  font-weight: 600;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
  border-color: transparent;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.end.retry {
  color: var(--idle);
  background: #f1f3f4;
}
.end:active,
.pill-btn:active {
  transform: scale(0.96);
}
.end:focus-visible,
.pill-btn:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: 3px;
}
.is-nav .dest,
.is-nav .hint,
.is-nav .foot,
.is-nav .eta {
  opacity: 1;
  transform: none;
  transition:
    opacity 0.45s ease,
    transform 0.55s var(--ease-out);
}
.is-nav .dest {
  opacity: 0.85;
}
.is-nav .foot {
  transition-delay: 0.06s;
}
/* ?demo=1／模擬 GPS：目的地前面的小標籤（01 規格：模擬時要標示） */
.sim-badge {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 9px;
  vertical-align: 0.1em;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.35);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

/* ── 共用箭頭 ─────────────────────── */
.hero {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 20;
  width: var(--hero, 240px);
  height: var(--hero, 240px);
  color: #fff;
  opacity: 0;
  transform-origin: 50% 50%;
  pointer-events: none;
  transition: color 0.5s ease;
}
/* 箭頭停在清單／搜尋欄上時，跟著版面（鍵盤彈出、清單捲動）滑過去，不跳 */
.settled .hero {
  transition:
    color 0.5s ease,
    transform 0.35s var(--ease-out);
}
.hero-arrow {
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
}
/* 等待中（搜尋、找位置、找路）：箭頭慢慢呼吸 */
.waiting .hero :deep(.am) {
  animation: breathe 1.3s ease-in-out infinite;
}
@keyframes breathe {
  50% {
    opacity: 0.4;
  }
}

/* ── 到站、坐車卡片 ───────────────── */
.card-layer {
  position: absolute;
  inset: 0;
  z-index: 25;
  overflow-y: auto;
}
.card-enter-active,
.card-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.45s var(--ease-out);
}
.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(24px);
}

/* ── 隱藏按鈕 ─────────────────────── */
.secret {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 30;
  width: 64px;
  height: calc(64px + env(safe-area-inset-top));
  opacity: 0;
  -webkit-touch-callout: none;
}
.secret:focus-visible {
  opacity: 1;
  outline: 3px solid #93d4df;
  outline-offset: -6px;
  border-radius: 16px;
}

@media (max-width: 600px) {
  .av {
    --point-gutter: 34px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .caret,
  .waiting .hero :deep(.am) {
    animation: none;
  }
  .hint,
  .foot,
  .is-nav .hint,
  .is-nav .foot,
  .step,
  .card-enter-from,
  .card-leave-to {
    transform: none;
  }
}
</style>
