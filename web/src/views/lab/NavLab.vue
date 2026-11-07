<script setup lang="ts">
/**
 * 導航實驗頁（N6 雛形）：把 nav/ 引擎接到畫面上，手機上可以直接測。
 * - 導到站牌（預設）：用真實定位，向 Valhalla 要「避開階梯、小巷」的步行路線，導到市立臺北特教學校站
 * - 模擬：位置沿合成路線前進，朝向是真實羅盤（室內可跑）
 * - 合成真實：用真實定位，路線以「你面向的方向」合成，走出去就能測箭頭、走偏、抵達
 * 文字是實驗用的中文；正式文案走 i18n（UI 負責）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LatLon } from '@/lib/contract'
import { createAnnouncer } from '@/nav/announcer'
import { easeRotation } from '@/nav/arrow'
import { NAV_CONFIG } from '@/nav/config'
import type { Cue } from '@/nav/announcer'
import { createNavMachine } from '@/nav/machine'
import type { NavMachine, NavState, NavView } from '@/nav/machine'
import { DEFAULT_DESTINATION, createDestinationLock } from '@/nav/destination'
import { ORIGIN_TAIPEI, twoLegRoute } from '@/nav/synth'
import { fetchWalkRoute } from '@/lib/walkRoute'
import type { WalkRoute } from '@/lib/walkRoute'
import { bearingDeg, distanceM } from '@/nav/geo'
import { createTraceRecorder } from '@/nav/trace'
import type { TraceRecorder } from '@/nav/trace'
import type { NavRoute } from '@/nav/machine'
import { ManualGpsSource } from '@/sensors/manual'
import type { PositionFix } from '@/sensors/source'
import { ReplaySensorSource } from '@/sensors/replay'
import type { SensorSource } from '@/sensors/source'
import { WakeLockHolder } from '@/sensors/wakelock'
import { WebSensorSource } from '@/sensors/web'
import NavDebugMap from './NavDebugMap.vue'

type Mode = 'route' | 'replay' | 'real'
const mode = ref<Mode>('route')
const routeInfo = ref<WalkRoute | null>(null)
const routeError = ref('')
const running = ref(false)
const view = ref<NavView | null>(null)
const cues = ref<string[]>([])
const rerouteFails = ref(false)
const speedX = ref(1)
const manualHeading = ref(0)
const useManualHeading = ref(false)
const permissionNote = ref('')
const wakeNote = ref('')
const showDebug = ref(false)
/** 模擬 GPS：位置由方向鍵／點地圖決定，朝向仍用真實羅盤（或手動滑桿） */
const simGps = ref(false)
const stepM = ref(5)
const simNote = ref('')
const destinationPoint = ref<LatLon | null>(null)
/** 由連續定位算出的行進方向（真北），用來和羅盤比對 */
const gpsCourse = ref<number | null>(null)
const traceCount = ref(0)

/** 模擬 GPS 拿不到真實位置時的起點：目的地站牌南方約 400 公尺 */
const SIM_FALLBACK_START: LatLon = [25.1136, 121.5347]

let machine: NavMachine | null = null
let source: SensorSource | null = null
let replay: ReplaySensorSource | null = null
let tickTimer: number | null = null
let manual: ManualGpsSource | null = null
let recorder: TraceRecorder | null = null
let courseFrom: LatLon | null = null
/** 目的地站位一趟只選一次，重算不可以換到對面站牌 */
const destLock = createDestinationLock(DEFAULT_DESTINATION)
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
      return '在這裡等公車'
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

function speakOrBuzz(cue: Cue) {
  log(`${cueText(cue)}${cue.haptic ? `  [震動 ${cue.haptic}]` : ''}`)
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

  destinationPoint.value = null
  destLock.reset()
  gpsCourse.value = null
  courseFrom = null
  manual = null
  const useSim = simGps.value && mode.value !== 'replay'
  const rec = createTraceRecorder(useSim ? `${mode.value}+sim-gps` : mode.value)
  recorder = rec
  traceCount.value = 0

  const heading = new WebSensorSource({ position: false })
  if (mode.value === 'replay') {
    const route = twoLegRoute(ORIGIN_TAIPEI, 0, { leg1M: 80, leg2M: 60, turn: 'right' })
    destinationPoint.value = route.geometry.at(-1)!
    replay = new ReplaySensorSource({ geometry: route.geometry, speedMps: 1.4, headingSource: heading })
    source = replay
    machine = createNavMachine({ route })
    rec.route(route)
  } else {
    replay = null
    if (useSim) {
      manual = new ManualGpsSource({ start: SIM_FALLBACK_START, headingSource: heading })
      source = manual
    } else {
      source = new WebSensorSource()
    }
    machine = createNavMachine({ route: null })
  }

  // 「開始走」的點擊事件內要求權限（iOS 羅盤）
  const perm = await source.requestPermission()
  permissionNote.value = perm === 'denied' ? '羅盤權限被拒絕，改用滑桿' : ''
  if (perm === 'denied') useManualHeading.value = true

  // 模擬 GPS 的起點：先試真實位置，拿不到就用預設點
  if (manual) {
    const real = await currentPositionOnce()
    manual.moveTo(real ?? SIM_FALLBACK_START)
    simNote.value = real ? '模擬 GPS：從你現在的位置出發' : '模擬 GPS：拿不到位置，從站牌南方約 400 公尺出發'
  } else {
    simNote.value = ''
  }

  const m = machine
  m.subscribe((v) => {
    view.value = v
    rec.view(v)
    traceCount.value = rec.count
    announcer.update(v).forEach(speakOrBuzz)
  })
  m.onEffect((e) => {
    if (mode.value === 'route') {
      void fetchRealRoute(m, e.from, e.candidate)
      return
    }
    // 模擬「API 回覆」：真實模式第一次是合成路線。
    // 合成路線沒有路線服務可以重算，重新規劃一律當作失敗 → back_to_route，
    // 箭頭指最近的路線點，用手上的路線把人帶回去。絕對不畫直線到終點（04）。
    window.setTimeout(() => {
      if (machine !== m) return // 使用者已經結束
      if (m.getView().state === 'routing') {
        // 第一次取得路線（真實模式）
        const route = twoLegRoute(e.from, m.getView().headingDeg ?? 0, { leg1M: 80, leg2M: 60, turn: 'right' })
        destinationPoint.value = route.geometry.at(-1)!
        return giveRoute(m, route)
      }
      log('合成路線無法重算，帶你回原路線')
      giveRoute(m, null)
    }, 700)
  })

  m.start()
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

/** 向 Valhalla 要從目前位置到目的地站牌的步行路線（避開階梯、小巷）；重新規劃也走這裡 */
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

/** 模擬 GPS：以目前朝向為前方，移動 stepM 的倍數 */
function simMove(forward: number, right: number) {
  if (!manual) return
  const h = view.value?.headingDeg ?? 0
  manual.step(h, forward * stepM.value, right * stepM.value)
}

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

function stopAll() {
  if (tickTimer) window.clearInterval(tickTimer)
  tickTimer = null
  source?.stop()
  source = null
  replay = null
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

function drift(east: number, north: number) {
  replay?.setOffset(east, north)
}

function setSpeed() {
  // 加速只改變前進距離；ReplaySensorSource 內每秒前進 speedMps，這裡額外推進
  if (replay && speedX.value > 1) replay.tick(speedX.value - 1)
}

function restart() {
  replay?.restart()
  announcer.reset()
  cues.value = []
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

// 讓使用者可以在跑的過程中加速
const speedTimer = window.setInterval(setSpeed, 1000)
onBeforeUnmount(() => window.clearInterval(speedTimer))

</script>

<template>
  <div
    class="flex min-h-dvh flex-col text-white"
    :style="{ background: running && view ? BG[view.state] : '#30383D' }"
  >
    <!-- 設定區：還沒開始時顯示 -->
    <section v-if="!running" class="space-y-4 p-4">
      <h1 class="text-xl font-bold">導航實驗</h1>
      <div class="space-y-2">
        <label class="flex items-center gap-2 rounded-lg bg-white/10 p-3">
          <input v-model="mode" type="radio" value="route" />
          <span>
            導到「{{ DEFAULT_DESTINATION.name }}」（真實定位，走到戶外；路線避開階梯、陡坡與小巷，
            會把你的座標送到公開的路徑服務）
          </span>
        </label>
        <label class="flex items-center gap-2 rounded-lg bg-white/10 p-3">
          <input v-model="mode" type="radio" value="replay" />
          <span>模擬行走（室內可測，朝向是真實羅盤）</span>
        </label>
        <label class="flex items-center gap-2 rounded-lg bg-white/10 p-3">
          <input v-model="mode" type="radio" value="real" />
          <span>真實定位＋合成路線（路線沿你面向的方向 80 公尺後右轉 60 公尺）</span>
        </label>
      </div>
      <label v-if="mode !== 'replay'" class="flex items-center gap-2 rounded-lg bg-white/10 p-3">
        <input v-model="simGps" type="checkbox" />
        <span>模擬 GPS（用方向鍵或點地圖移動，不用出門；朝向仍用手機羅盤）</span>
      </label>
      <button class="h-16 w-full rounded-xl bg-white text-lg font-bold text-[#30383D]" @click="begin">開始走</button>
      <p v-if="permissionNote" class="text-amber-200">{{ permissionNote }}</p>
      <router-link class="block text-center underline" to="/lab/sensors">← 感測實驗</router-link>
    </section>

    <!-- 導航畫面 -->
    <template v-else-if="view">
      <div v-if="mode === 'replay'" class="absolute left-3 top-3 rounded bg-white/20 px-2 py-1 text-sm">模擬</div>
      <div class="px-4 pt-10 text-center">
        <template v-if="mode === 'route'">
          <div class="text-2xl font-bold">{{ DEFAULT_DESTINATION.name }}</div>
          <div class="text-lg">
            <template v-if="routeInfo">全程 {{ routeInfo.distanceM }} 公尺，約 {{ Math.round(routeInfo.durationS / 60) }} 分鐘</template>
            <template v-else>正在規劃路線…</template>
          </div>
        </template>
        <template v-else>
          <div class="text-2xl font-bold">實驗路線</div>
          <div class="text-lg">{{ view.routeId ?? '合成路線' }}</div>
        </template>
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

      <!-- 模擬 GPS：方向鍵。前方 = 手機目前朝向；電腦可用鍵盤方向鍵，Q／E 轉向 -->
      <section v-if="simGps && mode !== 'replay'" class="space-y-2 px-4 pb-4">
        <div class="text-center text-sm opacity-80">{{ simNote }}</div>
        <div class="mx-auto grid w-56 grid-cols-3 gap-2">
          <span />
          <button class="h-14 rounded-lg bg-white/25 text-2xl" aria-label="往前" @click="simMove(1, 0)">↑</button>
          <span />
          <button class="h-14 rounded-lg bg-white/25 text-2xl" aria-label="往左" @click="simMove(0, -1)">←</button>
          <button class="h-14 rounded-lg bg-white/25 text-2xl" aria-label="往後" @click="simMove(-1, 0)">↓</button>
          <button class="h-14 rounded-lg bg-white/25 text-2xl" aria-label="往右" @click="simMove(0, 1)">→</button>
        </div>
        <label class="flex items-center justify-center gap-2 text-sm">每步
          <select v-model.number="stepM" class="rounded bg-white/20 px-2 py-1">
            <option :value="2">2 m</option>
            <option :value="5">5 m</option>
            <option :value="10">10 m</option>
            <option :value="20">20 m</option>
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

      <div class="flex justify-between px-6 pb-4">
        <button class="h-16 w-16 rounded-full bg-white text-2xl text-[#30383D]" aria-label="結束" @click="end">✕</button>
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

        <template v-if="mode === 'replay'">
          <div class="flex flex-wrap gap-2">
            <button class="rounded bg-white/20 px-3 py-2" @click="replay?.setPaused(true)">暫停</button>
            <button class="rounded bg-white/20 px-3 py-2" @click="replay?.setPaused(false)">繼續</button>
            <button class="rounded bg-white/20 px-3 py-2" @click="restart">重來</button>
            <button class="rounded bg-white/20 px-3 py-2" @click="drift(60, 0)">往東偏 60 m</button>
            <button class="rounded bg-white/20 px-3 py-2" @click="drift(0, 0)">回到路線</button>
          </div>
          <label class="flex items-center gap-2">速度 ×{{ speedX }}
            <input v-model.number="speedX" type="range" min="1" max="8" step="1" class="flex-1" />
          </label>
          <div class="text-sm opacity-80">合成路線不能重算：走偏後會帶你回原路線（back_to_route）</div>
        </template>
        <label v-if="mode === 'route'" class="flex items-center gap-2">
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
