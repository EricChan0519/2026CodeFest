<script setup lang="ts">
/**
 * 跟著箭頭走 · 新介面（UI 展示版，導航資料先用 demoNav 假資料）
 *
 * 整個畫面只有一個「共用箭頭」(.hero)：
 * 1. 開場在畫面中央轉一圈、重摔縮成主 logo（斜 45°），下方打字機打出「一鍵成行」。
 * 2. 標語滑到頂端，語言清單由左滑入（在畫面正中央），logo 滑到清單第一列的「左外側」指著它。
 *    點一個選項 → 箭頭上下滑到那一列 → 往選項戳一下、選項被按下去 → 清單淡出。
 * 3. 年紀清單（兒童／青年／長者）同樣由左滑入，箭頭滑到第一列外側。
 * 4. 搜尋欄由左滑入，箭頭在框外左側；送出時像滑動解鎖一樣推到框的右邊界，
 *    框淡出、箭頭停一下，再放大滑回畫面中央，轉向正上方，接上導航。
 * 只動 transform/opacity：過場用 Web Animations（合成器執行，跟著螢幕更新率），
 * 導航中用 rAF 平滑旋轉內層箭頭、轉到位就停。
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import ArrowMark from './ArrowMark.vue'
import { createDemoNav } from './demoNav'
import type { DemoState, DemoView, TurnKind } from './demoNav'
import { K_LOGO, K_NAV, heroSize, innerT, outerT, poseAt, reducedMotion, shortestDelta } from './pose'
import type { Pose } from './pose'

const DebugSheet = defineAsyncComponent(() => import('./DebugSheet.vue'))

type Phase = 'intro' | 'brand' | 'lang' | 'age' | 'search' | 'launch' | 'nav'
type StepName = 'lang' | 'age' | 'search'
type StepState = 'off' | 'in' | 'out'

/** 開場 logo 斜 45° */
const LOGO_DEG = 45
/** 在清單、搜尋欄外側時指向右（指著選項） */
const POINT_DEG = 90
/** 指著選項時，窄螢幕縮小箭頭，讓清單保有更多空間 */
const pointBox = () => (window.innerWidth <= 600 ? 26 : 36)
const K_POINT = 0.72
/** 箭頭尖端和框之間的空隙 */
const POINT_GAP = 8
const EASE_LIST = 'cubic-bezier(0.2, 0.9, 0.1, 1)' // 和 CSS 的 --ease-out 一樣
const EASE_MOVE = 'cubic-bezier(0.3, 0.7, 0.2, 1)'
const EASE_UNLOCK = 'cubic-bezier(0.55, 0, 0.25, 1)' // 推過去、在邊界輕輕停住
const T_INTRO = 1900
const T_LIST = 620
const T_MOVE = 300
const T_PRESS = 280
const T_FADE = 250
const T_UNLOCK = 650
const T_HOLD = 380
const T_LAUNCH = 820

/** 選項清單（語言名稱用各自的語言寫，看得懂自己的語言就能選） */
const LISTS = {
  lang: {
    title: '選擇語言',
    sub: 'Language',
    key: 'arrow.lang',
    items: [
      { id: 'zh-TW', label: '繁體中文', lang: 'zh-TW' },
      { id: 'en', label: 'English', lang: 'en' },
      { id: 'th', label: 'ไทย', lang: 'th' },
      { id: 'vi', label: 'Tiếng Việt', lang: 'vi' },
      { id: 'id', label: 'Bahasa Indonesia', lang: 'id' },
      { id: 'km', label: 'ខ្មែរ', lang: 'km' },
      { id: 'ja', label: '日本語', lang: 'ja' },
      { id: 'ko', label: '한국어', lang: 'ko' },
    ],
  },
  age: {
    title: '誰要使用？',
    sub: '',
    key: 'arrow.age',
    items: [
      { id: 'child', label: '兒童', lang: 'zh-TW' },
      { id: 'youth', label: '青年', lang: 'zh-TW' },
      { id: 'elder', label: '長者', lang: 'zh-TW' },
    ],
  },
} as const
type ListName = keyof typeof LISTS

const phase = ref<Phase>('intro')
const steps = reactive<Record<StepName, StepState>>({ lang: 'off', age: 'off', search: 'off' })
const picked = ref(-1) // 剛被點的那一列
const busy = ref(false) // 過場中不收點擊
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
const unlocking = ref(false)
const destName = ref('')
const debugOpen = ref(false)
const forced = ref<DemoState | null>(null)
const speed = ref(6)
const view = shallowRef<DemoView>({ state: 'navigating', arrowDeg: 0, destinationDeg: null, remainingM: 0, offRouteM: 0, next: null })
const destinationRotation = ref(0)

const demo = createDemoNav((v) => {
  view.value = v
  if (v.destinationDeg !== null) destinationRotation.value += shortestDelta(destinationRotation.value, v.destinationDeg)
  if (phase.value === 'nav') track(v.arrowDeg)
})

// ── 共用箭頭 ─────────────────────────────────────────
let size = 240
let rot = 0 // 導航中的箭頭角度（累加）
let cur: Pose = { x: 0, y: 0, s: 1, r: 0, k: K_LOGO } // 箭頭目前（最後一段過場結束時）的姿勢
let navPose: Pose = { x: 0, y: 0, s: 1, r: 0, k: K_NAV }
let anims: Animation[] = []
let sweepAnim: Animation | undefined
let armRow = 0 // 箭頭目前指著哪一列
let seq = 0 // 每段過場的編號；被打斷時舊的 await 之後就不要再動
let fullH = 0 // 沒有鍵盤時的視窗高度（判斷鍵盤是否開著）

const dur = (ms: number): number => (reducedMotion() ? 0 : ms)
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const logoPose = (r: number): Pose => poseAt(logoSlot.value!, size, r, K_LOGO)
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
      const last = frames[frames.length - 1]
      setHero(last.p)
      hero.value!.style.opacity = String(last.opacity ?? 1)
      mine.forEach((a) => a.cancel())
      if (anims === mine) anims = []
      resolve()
    }
    outer.oncancel = () => resolve()
  })
}

function measure() {
  size = heroSize()
  root.value!.style.setProperty('--hero', `${size}px`)
  fullH = Math.max(fullH, window.innerHeight)
}

// ── 步驟（清單、搜尋欄）的位置 ───────────────────────
const stepEl = (s: StepName) => root.value!.querySelector<HTMLElement>(`[data-step="${s}"]`)!
/** 箭頭指著的框（清單的一列、搜尋欄） */
const boxEl = (s: StepName, i: number) =>
  stepEl(s).querySelector<HTMLElement>(s === 'search' ? '.search' : `[data-i="${i}"]`)!
/** 步驟目前的水平位移（滑入中是負的） */
const stepDx = (s: StepName) => stepEl(s).getBoundingClientRect().left - stepsEl.value!.getBoundingClientRect().left

/** 箭頭停在框的左外側、垂直置中、尖端離框 POINT_GAP（用框「滑入完成後」的位置） */
function pointPose(s: StepName, i: number, r = pointAngle(cur.r)): Pose {
  const b = boxEl(s, i).getBoundingClientRect()
  const box = pointBox()
  const cx = b.left - stepDx(s) - POINT_GAP - (box * K_POINT) / 2
  return { x: cx - size / 2, y: b.top + b.height / 2 - size / 2, s: box / size, r, k: K_POINT }
}

/** 步驟由左滑入，箭頭同時滑到第一列外側 */
async function enterStep(s: StepName, from: Pose = cur) {
  const my = ++seq
  busy.value = true
  if (s === 'search') unlocking.value = false
  picked.value = -1
  sweepAnim?.cancel()
  sweepAnim = undefined
  steps[s] = 'in'
  await nextTick()
  armRow = 0
  await play([{ p: from }, { p: pointPose(s, 0, pointAngle(from.r)) }], dur(T_LIST), EASE_LIST)
  if (my !== seq) return
  busy.value = false
}

/** 步驟淡出（清單整個一起） */
async function leaveStep(s: StepName, ms = T_FADE) {
  steps[s] = 'out'
  await wait(dur(ms))
  steps[s] = 'off'
}

/** 選清單裡的一項：箭頭上下滑到那一列 → 戳一下、那一列被按下去 → 清單淡出 → 下一步 */
async function pick(s: ListName, i: number) {
  if (busy.value || phase.value !== s) return
  const my = ++seq
  busy.value = true
  save(LISTS[s].key, LISTS[s].items[i].id)
  if (i !== armRow) {
    await play([{ p: cur }, { p: pointPose(s, i) }], dur(T_MOVE), EASE_MOVE)
    if (my !== seq) return
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
  if (my !== seq) return
  await wait(dur(120))
  await leaveStep(s)
  if (my !== seq) return
  const next: StepName = s === 'lang' ? 'age' : 'search'
  phase.value = next
  await enterStep(next)
}

function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    // 無痕模式等存不了就算了，只是下次要再選
  }
}

/** 標語滑到頂端（對齊 .dock 的位置） */
function updateLift() {
  if (!titleEl.value || !dock.value) return
  const natural = titleEl.value.getBoundingClientRect().top - lift.value
  lift.value = dock.value.getBoundingClientRect().top - natural
}

// 導航中的旋轉：目標角度一變就用 rAF 指數平滑追上，追到就停（不一直跑迴圈）
let target = 0
let raf = 0
let lastT = 0
function track(deg: number) {
  target += shortestDelta(target, deg)
  if (!raf) {
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }
}
function frame(now: number) {
  const k = 1 - Math.exp(-(now - lastT) / 140)
  lastT = now
  rot += (target - rot) * k
  if (Math.abs(target - rot) < 0.05) rot = target
  heroArrow.value!.style.transform = innerT({ r: rot, k: K_NAV })
  raf = rot === target ? 0 : requestAnimationFrame(frame)
}
function stopTrack() {
  cancelAnimationFrame(raf)
  raf = 0
}

// ── 過場 ─────────────────────────────────────────────
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

/** 打完標語：標語上移，語言清單滑入，logo 滑到第一列外側 */
async function startSetup() {
  if (phase.value !== 'brand') return
  clearInterval(typeTimer)
  clearTimeout(flowTimer)
  typed.value = BRAND.length
  phase.value = 'lang'
  updateLift()
  await enterStep('lang')
}

/** 點一下畫面：跳過開場；標語還在打就直接打完、進下一步 */
function skipIntro() {
  if (phase.value === 'intro') anims.forEach((a) => a.finish())
  else if (phase.value === 'brand') startSetup()
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

let submitting = false
async function go() {
  const name = query.value.trim()
  if (!name || phase.value !== 'search' || busy.value || submitting) return
  submitting = true
  await closeKeyboard()
  submitting = false
  if (phase.value !== 'search') return
  const my = ++seq
  busy.value = true
  destName.value = name
  unlocking.value = true
  await nextTick()
  if (my !== seq) return
  setHero(pointPose('search', 0)) // 版面可能剛變過，從量到的位置開始

  // 1. 滑動解鎖：箭頭從框外推到框的右邊界，亮色跟著尖端填滿搜尋欄
  const box = boxEl('search', 0)
  const b = box.getBoundingClientRect()
  const tip0 = cur.x + size / 2 + (pointBox() * K_POINT) / 2
  const tip1 = b.right - 4
  const t = dur(T_UNLOCK)
  const enter = Math.min(0.95, Math.max(0, (b.left - tip0) / (tip1 - tip0)))
  sweepAnim = box.querySelector<HTMLElement>('.sweep')!.animate(
    [
      { transform: 'scaleX(0)', opacity: 1, offset: 0 },
      { transform: 'scaleX(0)', opacity: 1, offset: enter },
      { transform: 'scaleX(1)', opacity: 1, offset: 1 },
    ],
    { duration: t, easing: EASE_UNLOCK, fill: 'forwards' },
  )
  await play([{ p: cur }, { p: { ...cur, x: cur.x + (tip1 - tip0) } }], t, EASE_UNLOCK)
  if (my !== seq) return

  // 2. 框淡出，箭頭停在右邊界一下
  leaveStep('search', T_HOLD)
  await wait(dur(T_HOLD))
  if (my !== seq) return

  // 3. 放大滑回畫面中央，同時由指向右轉成指向正上方，接上導航
  phase.value = 'launch'
  demo.start()
  await nextTick()
  rot = cur.r - POINT_DEG
  navPose = navPoseNow()
  await play([{ p: cur }, { p: navPose }], dur(T_LAUNCH), 'cubic-bezier(0.45, 0, 0.1, 1)')
  if (my !== seq) return
  busy.value = false
  target = rot
  phase.value = 'nav'
  track(view.value.arrowDeg)
}

/** 結束導航：箭頭縮回搜尋欄左外側，搜尋欄再由左滑入 */
async function endNav() {
  if (phase.value !== 'nav' && phase.value !== 'launch') return
  demo.stop()
  stopTrack()
  forced.value = null
  const from: Pose = { ...navPose, r: rot }
  query.value = ''
  view.value = { ...view.value, state: 'navigating' }
  phase.value = 'search'
  await enterStep('search', from)
}

// ── 畫面文字 ─────────────────────────────────────────
const TURN_WORD: Record<TurnKind, string> = {
  straight: '直走',
  bear_left: '靠左走',
  bear_right: '靠右走',
  left: '左轉',
  right: '右轉',
  turn_around: '迴轉',
}
const TURN_DEG: Record<TurnKind, number> = {
  straight: 0,
  bear_left: -45,
  bear_right: 45,
  left: -90,
  right: 90,
  turn_around: 180,
}
function meters(d: number): string {
  if (d >= 1000) return `${(d / 1000).toFixed(1)} 公里`
  const step = d > 100 ? 10 : 5
  return `${Math.max(step, Math.round(d / step) * step)} 公尺`
}

const tone = computed(() => {
  const s = view.value.state
  if (s === 'arrived') return 'arrived'
  if (s === 'navigating') return 'go'
  return 'warn'
})
const hollow = computed(() => view.value.state === 'weak_signal' || view.value.state === 'rerouting')
const done = computed(() => view.value.state === 'arrived' && phase.value === 'nav')
/** 箭頭停在清單或搜尋欄旁、沒有過場 → 版面變動時讓它滑過去不跳 */
const settled = computed(() => !busy.value && (phase.value === 'lang' || phase.value === 'age' || phase.value === 'search'))

const hint = computed(() => {
  const v = view.value
  switch (v.state) {
    case 'weak_signal':
      return { deg: 0, main: '訊號不好', sub: '先停一下，等訊號回來' }
    case 'rerouting':
      return { deg: 0, main: '重新找路', sub: '站在原地等一下' }
    case 'back_to_route':
      return { deg: 0, main: '先回到路上', sub: `照箭頭走 ${meters(v.offRouteM)}` }
    case 'arrived':
      return { deg: 0, main: '到了', sub: destName.value }
  }
  const n = v.next
  if (!n || n.distanceM > 150)
    return {
      deg: 0,
      main: '直走',
      sub: n ? `${meters(n.distanceM)}後${TURN_WORD[n.kind]}` : `再 ${meters(v.remainingM)}就到了`,
    }
  const word = TURN_WORD[n.kind]
  if (n.distanceM < 20) return { deg: TURN_DEG[n.kind], main: `現在${word}`, sub: n.street }
  return { deg: TURN_DEG[n.kind], main: word, sub: `${meters(n.distanceM)}後 · ${n.street}` }
})
const minutes = computed(() => Math.max(1, Math.round(view.value.remainingM / 60))) // 長者步行約 1 m/s
// 報讀只在「說法」變的時候更新，不跟著距離每 0.1 秒刷新
const announce = computed(() => (phase.value === 'nav' ? hint.value.main : ''))

// ── 標語：logo 落定後打字機打出「一鍵成行」，停一下再進語言清單 ─────
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
function setForced(s: DemoState | null) {
  forced.value = s
  demo.force(s)
}
function setSpeed(v: number) {
  speed.value = v
  demo.setSpeed(v)
}

// 除錯面板打開時導航箭頭往上挪，面板不擋箭頭（才看得到搖桿的效果）
watch(debugOpen, async () => {
  if (phase.value !== 'nav') return
  await nextTick()
  const from = { ...navPose, r: rot }
  navPose = navPoseNow()
  await play([{ p: from, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' }, { p: { ...navPose, r: rot } }], 360)
})

// ── 版面變動（轉向、鍵盤、清單捲動） ─────────────────
let resizeRaf = 0
function onResize() {
  cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    measure()
    if (anims.length) return // 過場中不打斷；過場結束時的位置是量出來的
    const p = phase.value
    if (p !== 'intro' && p !== 'brand') updateLift()
    if (p === 'brand') setHero(logoPose(cur.r))
    else if ((p === 'lang' || p === 'age' || p === 'search') && steps[p] === 'in')
      setHero(pointPose(p, p === 'search' ? 0 : armRow))
    else if (p === 'nav') {
      navPose = navPoseNow()
      setHero({ ...navPose, r: rot })
    }
  })
}

onMounted(() => {
  document.title = '跟著箭頭走'
  measure()
  if (new URLSearchParams(location.search).has('debug')) debugOpen.value = true
  window.addEventListener('resize', onResize)
  intro()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  demo.stop()
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
    :class="[`is-${phase}`, `tone-${tone}`, { 'dbg-on': debugOpen, settled }]"
    @pointerdown.capture="skipIntro"
  >
    <!-- 背景是單色（.av 的 background-color）：首頁深色，導航換成狀態色，只做顏色過渡 -->

    <!-- 開場：logo＋標語整組在畫面正中央（共用箭頭疊在 logo-slot 上）；之後標語滑到頂端 -->
    <main class="home">
      <h1 class="sr-only">跟著箭頭走 · 一鍵成行</h1>
      <div class="stack">
        <div ref="logoSlot" class="logo-slot" />
        <!-- 隱形的整句撐住寬度，打出來的字疊在上面從左邊開始 → 置中但不會邊打邊跳 -->
        <p ref="titleEl" class="title brand-text" aria-hidden="true" :style="{ '--lift': `${lift}px` }">
          <span class="ask-ghost">{{ BRAND }}</span>
          <span class="ask-typed">{{ BRAND.slice(0, typed) }}<i class="caret" :class="{ off: typed >= BRAND.length }" /></span>
        </p>
      </div>
    </main>

    <!-- 設定步驟：語言 → 年紀 → 搜尋，同一個位置輪流由左滑入。
         上下各放一個和標語等高的 .dock → 中間的操作區剛好落在畫面正中央 -->
    <div class="setup">
      <p ref="dock" class="dock brand-text" aria-hidden="true">{{ BRAND }}</p>
      <div ref="stepsEl" class="steps">
        <section
          v-for="(list, name) in LISTS"
          :key="name"
          class="step"
          :class="`st-${steps[name]}`"
          :data-step="name"
          :inert="steps[name] !== 'in'"
          :aria-labelledby="`h-${name}`"
        >
          <div class="step-body">
            <h2 :id="`h-${name}`" class="step-h">
              {{ list.title }}<span v-if="list.sub" class="step-sub" lang="en">{{ list.sub }}</span>
            </h2>
            <ul class="list" @scroll.passive="onResize">
              <li v-for="(item, i) in list.items" :key="item.id">
                <button
                  type="button"
                  class="row"
                  :class="{ picked: picked === i }"
                  :data-i="i"
                  :lang="item.lang"
                  @click="pick(name, i)"
                >
                  {{ item.label }}
                </button>
              </li>
            </ul>
          </div>
        </section>

        <section
          class="step"
          :class="`st-${steps.search}`"
          data-step="search"
          :inert="steps.search !== 'in'"
          aria-labelledby="h-search"
        >
          <div class="step-body">
            <h2 id="h-search" class="step-h">要去哪裡？</h2>
            <form class="search" role="search" @submit.prevent="go">
              <span class="sweep" aria-hidden="true" />
              <label for="dest" class="sr-only">要去哪裡？</label>
              <input
                id="dest"
                ref="input"
                v-model="query"
                type="search"
                enterkeyhint="search"
                autocomplete="off"
                placeholder="地點或公車站"
              />
              <button v-show="!unlocking" type="submit" class="find" :disabled="!query.trim()" aria-label="搜尋">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M15.5 15.5L20.5 20.5" />
                </svg>
              </button>
            </form>
          </div>
        </section>
      </div>
      <p class="dock brand-text" aria-hidden="true">{{ BRAND }}</p>
    </div>

    <!-- 導航：上方轉彎提示、中央箭頭（共用箭頭疊在 nav-slot 上）、下方距離與結束 -->
    <section class="nav" :inert="phase !== 'nav'" aria-label="導航">
      <div class="hint">
        <span class="hint-ico" :style="{ transform: `rotate(${hint.deg}deg)` }">
          <ArrowMark navigation :hollow="hollow" :done="view.state === 'arrived'" />
        </span>
        <div class="hint-text">
          <p class="hint-main">{{ hint.main }}</p>
          <p class="hint-sub">{{ hint.sub }}</p>
        </div>
      </div>

      <div class="nav-mid">
        <div ref="navSlot" class="nav-slot">
          <div v-if="phase === 'nav' && view.destinationDeg !== null" class="destination-orbit" :style="{ transform: `rotate(${destinationRotation}deg)` }" aria-hidden="true">
            <span class="destination-dot" />
          </div>
        </div>
        <div v-if="view.state !== 'arrived'" class="eta">
          <p>剩 <b>{{ meters(view.remainingM) }}</b></p>
          <p class="eta-minutes">約 {{ minutes }} 分</p>
        </div>
      </div>

      <div class="foot">
        <template v-if="view.state !== 'arrived'">
          <button type="button" class="glass end" @click="endNav">停止導航</button>
        </template>
        <button v-else type="button" class="glass end" @click="endNav">完成</button>
      </div>
    </section>
    <p class="sr-only" aria-live="polite">{{ announce }}</p>

    <!-- 共用箭頭：外層管位置大小，內層箭頭管角度 -->
    <div ref="hero" class="hero" aria-hidden="true">
      <div ref="heroArrow" class="hero-arrow">
        <ArrowMark :navigation="phase === 'launch' || phase === 'nav'" :hollow="hollow && phase === 'nav'" :done="done" />
      </div>
    </div>

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

    <DebugSheet
      v-if="debugOpen"
      :forced="forced"
      :speed="speed"
      :navigating="phase === 'nav'"
      @close="debugOpen = false"
      @force="setForced"
      @speed="setSpeed"
      @joystick="demo.joystick($event)"
    />
  </div>
</template>

<style scoped>
.av {
  --ink: #f1f3f4;
  --ink-2: rgb(241 243 244 / 0.72);
  --arc: #93d4df;
  /* 霧化玻璃元件：半透明白＋細邊，上緣亮一點（不用陰影、不用 backdrop-filter） */
  --glass: rgb(255 255 255 / 0.08);
  --glass-edge: rgb(255 255 255 / 0.14);
  --glass-rim: rgb(255 255 255 / 0.3);
  --go: #008849;
  --warn: #74521b;
  --arrived: #008849;
  --ease-out: cubic-bezier(0.2, 0.9, 0.1, 1);
  /* 清單、搜尋欄左邊留給箭頭的空間（箭頭在框外）；右邊少留一點讓整組看起來置中 */
  --point-gutter: 44px;
  position: relative;
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  color: var(--ink);
  /* 單色背景：首頁深色；導航換成規格的狀態色 */
  background-color: #10171a;
  transition: background-color 0.6s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.is-launch,
.is-nav {
  background-color: var(--go);
}
.is-nav.tone-warn {
  background-color: var(--warn);
}
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
  width: 132px;
  height: 132px;
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
/* 搜尋欄淡出慢一點：箭頭停在右邊界時框慢慢消失 */
.step.st-out[data-step='search'] {
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
.step-h {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 12px 2px;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
}
.step-sub {
  font-size: 15px;
  font-weight: 500;
  color: var(--ink-2);
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
.row {
  position: relative;
  width: 100%;
  height: 50px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  border-radius: 16px;
  background: var(--glass);
  border: 1px solid var(--glass-edge);
  border-top-color: var(--glass-rim);
  color: var(--ink);
  font-size: 18px;
  font-weight: 600;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}
.row:active {
  background: rgb(255 255 255 / 0.13);
}
/* 被點的那列：亮起來（箭頭戳下去的同時） */
.row.picked {
  background: rgb(147 212 223 / 0.24);
  border-color: rgb(147 212 223 / 0.75);
}
.row:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: 2px;
}

/* 搜尋欄：細一點，右端是放大鏡；送出時亮色跟著箭頭從左填到右 */
.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 4px 0 16px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--glass);
  border: 1px solid var(--glass-edge);
  border-top-color: var(--glass-rim);
}
.search:focus-within {
  background: rgb(255 255 255 / 0.12);
  border-color: rgb(147 212 223 / 0.7);
}
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
  font-size: 17px;
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
  padding: calc(16px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));
  color: #fff;
}
/* 液態玻璃：首頁搜尋欄與導航的提示、按鈕同一套（半透明白＋上緣亮邊，不用陰影、不用 backdrop-filter） */
.glass {
  border-radius: 20px;
  background: var(--glass);
  border: 1px solid var(--glass-edge);
  border-top-color: var(--glass-rim);
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
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.01em;
}
.hint-sub {
  margin-top: 2px;
  font-size: 18px;
  line-height: 1.4;
  opacity: 0.92;
  overflow-wrap: anywhere;
}
.nav-mid {
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
  width: var(--hero, 240px);
  height: var(--hero, 240px);
}
.destination-orbit {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: transform 0.25s linear;
}
.destination-dot {
  position: absolute;
  top: 0;
  left: 50%;
  width: 14px;
  height: 14px;
  border: 4px solid rgb(255 255 255 / 0.35);
  border-radius: 50%;
  background: #fff;
  background-clip: padding-box;
  transform: translate(-50%, -50%);
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
  margin-top: 28px;
  text-align: center;
  font-size: 26px;
  font-weight: 400;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 0.45s ease;
}
.eta b {
  font-size: 32px;
  font-weight: 600;
}
.eta-minutes {
  margin-top: 8px;
  opacity: 0.85;
}
.end {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 600;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
  border-color: transparent;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.end:active {
  transform: scale(0.96);
}
.end:focus-visible {
  outline: 3px solid var(--arc);
  outline-offset: 3px;
}
.is-nav .hint,
.is-nav .foot,
.is-nav .eta {
  opacity: 1;
  transform: none;
  transition:
    opacity 0.45s ease,
    transform 0.55s var(--ease-out);
}
.is-nav .foot {
  transition-delay: 0.06s;
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
.is-launch .hero,
.is-nav .hero {
  color: #fff;
}
.hero-arrow {
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
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
  .caret {
    animation: none;
  }
  .hint,
  .foot,
  .is-nav .hint,
  .is-nav .foot,
  .step {
    transform: none;
  }
}
</style>
