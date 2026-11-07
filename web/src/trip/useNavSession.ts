/**
 * 一段走路導航的執行期：感測器（真實或模擬 GPS）、導航機、路線、螢幕常亮、回到前景重新定位、軌跡紀錄。
 * 邏輯搬自 views/lab/NavLab.vue（實驗頁仍保留自己的一份），給主畫面 views/arrow/ArrowView.vue 用。
 * 畫面只要：begin(目的地) → 看 view → 結束時 stop()。
 */
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Audience, LatLon, RouteMode } from '@/lib/contract'
import type { Locator } from '@/lib/locator'
import { fetchRoutePlan, PLAN_REUSE_M } from '@/lib/modeRoute'
import type { ModeRoute } from '@/lib/modeRoute'
import { createAnnouncer } from '@/nav/announcer'
import type { Cue } from '@/nav/announcer'
import { createDestinationLock, DEFAULT_DESTINATION } from '@/nav/destination'
import type { Destination, DestinationLock } from '@/nav/destination'
import { bearingDeg, distanceM } from '@/nav/geo'
import { createNavMachine } from '@/nav/machine'
import type { NavMachine, NavRoute, NavView, ResyncReason } from '@/nav/machine'
import { createTraceRecorder } from '@/nav/trace'
import type { TraceRecorder } from '@/nav/trace'
import type { JoystickVector } from '@/sensors/joystick'
import { ManualGpsSource } from '@/sensors/manual'
import type { PositionFix, SensorSource } from '@/sensors/source'
import { WakeLockHolder } from '@/sensors/wakelock'
import { WebSensorSource } from '@/sensors/web'

export const RESYNC_TEXT: Record<ResyncReason, string> = {
  manual: '手動',
  resumed: '回到畫面',
  heading_silent: '羅盤沒有資料',
  heading_frozen: '羅盤數值卡住',
  course_mismatch: '羅盤與實際走向不符',
}

/** 每秒的計時器隔超過這麼久才回來，代表頁面被凍結過 */
const RESUME_GAP_MS = 3000
/** 鍵盤方向鍵一次移動幾公尺 */
const KEY_STEP_M = 5

export interface NavSessionOptions {
  locator: Locator
  /** 這段走到了（導航機進入 arrived），只呼叫一次 */
  onArrived: () => void
  /** 要念出來或震動的提示 */
  onCue?: (cue: Cue) => void
  /** 使用者選的路線模式與對象（走路速度）；沒給就是快速、一般速度 */
  routing?: { mode: () => RouteMode; audience: () => Audience; simulate?: () => 'night' | null }
}

/** 這一段走路要用的路：路線模式（使用者在「怎麼去」選最快的路時是 fast），和已經規劃好的那條 */
export interface LegRouting {
  mode?: RouteMode
  /** 「怎麼去」畫面算好、使用者看過的路；目前位置離 plannedFrom 不遠就直接用 */
  preplanned?: ModeRoute | null
  /** 算 preplanned 時的起點（使用者當時的位置，不是路線吸附到路上的第一個點） */
  plannedFrom?: LatLon | null
}

export function useNavSession(opts: NavSessionOptions) {
  const view = shallowRef<NavView | null>(null)
  /** 模擬 GPS 的即時位置：搖桿每 100 ms 更新（給除錯地圖畫順用；導航本身仍是每 500 ms 收一次位置） */
  const simHere = shallowRef<LatLon | null>(null)
  const running = ref(false)
  const routeInfo = shallowRef<ModeRoute | null>(null)
  /** 這一段實際用的路線模式 */
  const legMode = ref<RouteMode>('fast')
  const routeError = ref('')
  const permissionNote = ref('')
  const wakeNote = ref('')
  /** 除錯紀錄：語音／震動、重新定位、路線 */
  const log = ref<string[]>([])
  /** 模擬 GPS：位置由搖桿／點地圖決定，朝向仍用真實羅盤（或手動朝向） */
  const simGps = ref(false)
  /** 搖桿「往上」：map＝地圖上方（北）；phone＝手機面對的方向 */
  const joyFrame = ref<'map' | 'phone'>('map')
  /** 搖桿推到底的速度（公尺／秒）；1.4 約等於步行 */
  const simSpeed = ref(15) // Demo 用：預設 15 m/s，走一段路不用推太久
  const simNote = ref('')
  /** 重新規劃一律失敗，用來測 back_to_route */
  const rerouteFails = ref(false)
  const useManualHeading = ref(false)
  const manualHeading = ref(0)
  const destinationPoint = ref<LatLon | null>(null)
  /** 由連續定位算出的行進方向（真北），用來和羅盤比對 */
  const gpsCourse = ref<number | null>(null)
  const traceCount = ref(0)
  /** 這一段實際導航的目的地（開始時固定，之後改搜尋結果不影響） */
  const active = shallowRef<Destination | null>(null)

  let machine: NavMachine | null = null
  let source: SensorSource | null = null
  let manual: ManualGpsSource | null = null
  let recorder: TraceRecorder | null = null
  let tickTimer: number | null = null
  let lastTickAt = 0
  let courseFrom: LatLon | null = null
  let destLock: DestinationLock = createDestinationLock(DEFAULT_DESTINATION)
  let arrivedHandled = false
  let lastSimStart: LatLon | undefined
  let lastLeg: LegRouting = {}
  let preplanned: { route: ModeRoute; from: LatLon } | null = null
  const wake = new WakeLockHolder()
  const announcer = createAnnouncer()

  function note(line: string) {
    log.value = [`${new Date().toLocaleTimeString()} ${line}`, ...log.value].slice(0, 12)
  }

  /** 模擬 GPS 拿不到真實位置時的起點：目的地正南方約 400 公尺 */
  function simFallbackStart(): LatLon {
    const [lat, lon] = active.value?.points[0] ?? DEFAULT_DESTINATION.points[0]!
    return [lat - 0.0036, lon]
  }

  /**
   * 開始走一段。一定要在使用者點擊的事件裡呼叫（同步執行到 requestPermission），iOS 才會給羅盤權限。
   * simStart：模擬 GPS 的起點（下車站）；沒給就先試真實位置。
   * leg：這一段的路線模式與規劃好的路（見 LegRouting）。
   */
  async function begin(dest: Destination, simStart?: LatLon, leg: LegRouting = {}) {
    stopAll()
    lastLeg = leg
    legMode.value = leg.mode ?? opts.routing?.mode() ?? 'fast'
    preplanned = leg.preplanned && leg.plannedFrom ? { route: leg.preplanned, from: leg.plannedFrom } : null
    announcer.reset()
    view.value = null
    routeInfo.value = null
    routeError.value = ''
    active.value = dest
    lastSimStart = simStart
    destinationPoint.value = null
    destLock = createDestinationLock(dest)
    gpsCourse.value = null
    courseFrom = null
    manual = null
    const useSim = simGps.value
    const rec = createTraceRecorder(useSim ? 'route+sim-gps' : 'route')
    recorder = rec
    traceCount.value = 0

    const heading = new WebSensorSource({ position: false })
    const src: SensorSource = useSim
      ? (manual = new ManualGpsSource({ start: simFallbackStart(), headingSource: heading }))
      : new WebSensorSource()
    source = src
    const m = createNavMachine({ route: null })
    machine = m

    const perm = await src.requestPermission()
    if (machine !== m) return
    permissionNote.value = perm === 'denied' ? '羅盤權限被拒絕，改用手動朝向' : ''
    if (perm === 'denied') useManualHeading.value = true

    if (manual && simStart) {
      manual.moveTo(simStart)
      simNote.value = '模擬 GPS：從下車站出發'
    } else if (manual) {
      const real = (await opts.locator.current()) ?? null
      if (machine !== m) return
      manual?.moveTo(real ?? simFallbackStart())
      simNote.value = real ? '模擬 GPS：從你現在的位置出發' : '模擬 GPS：拿不到位置，從目的地南方約 400 公尺出發'
    } else {
      simNote.value = ''
    }

    arrivedHandled = false
    m.subscribe((v) => {
      view.value = v
      rec.view(v)
      traceCount.value = rec.count
      announcer.update(v).forEach((c) => {
        note(`${c.key}${c.turn ? ` ${c.turn}` : ''}${c.haptic ? `  [震動 ${c.haptic}]` : ''}${c.speak ? '' : '  [不出聲]'}`)
        opts.onCue?.(c)
      })
      if (v.state === 'arrived' && !arrivedHandled) {
        arrivedHandled = true
        stopAll()
        opts.onArrived()
      }
    })
    m.onEffect((e) => void fetchRealRoute(m, e.from, e.candidate))
    m.onResync((reason) => {
      note(`自動重新定位：${RESYNC_TEXT[reason]}`)
      source?.resync?.()
    })

    m.start()
    lastTickAt = Date.now()
    src.start({
      onHeading: (d) => {
        if (useManualHeading.value) return
        rec.heading(d)
        m.onHeading(d)
      },
      onPosition: (p) => {
        rec.position(p)
        updateCourse(p)
        // 真實 GPS 的位置也記下來：中斷導航後再搜尋，用的是這裡（模擬 GPS 不算）
        if (!useSim) opts.locator.feed([p.lat, p.lon], p.accuracyM)
        m.onPosition(p)
      },
      onError: (c) => {
        note(`感測錯誤 ${c}`)
        m.onError(c)
      },
    })
    tickTimer = window.setInterval(() => {
      const now = Date.now()
      if (now - lastTickAt > RESUME_GAP_MS) recalibrate('resumed')
      lastTickAt = now
      if (useManualHeading.value) {
        rec.heading(manualHeading.value)
        m.onHeading(manualHeading.value) // 手動朝向要持續餵，不然會被判斷成沒有羅盤
      }
      m.tick()
    }, 1000)
    running.value = true
    const ok = await wake.on()
    wakeNote.value = ok ? '螢幕常亮已開' : wake.supported ? '螢幕常亮失敗' : '此環境不支援螢幕常亮'
  }

  /** 同一個目的地重新開始（找不到路、切換模擬 GPS 時） */
  function restart() {
    // 重來時重新算路，不沿用規劃好的那條
    if (active.value) void begin(active.value, lastSimStart, { mode: lastLeg.mode })
  }

  /**
   * 向後端要從目前位置到目的地的步行路線（依路線模式挑，不超過最快路線 1.2 倍時間）；重新規劃也走這裡。
   * 第一次（不是重新規劃）而且起點離「怎麼去」規劃的起點不遠，就直接用使用者看過的那條。
   */
  async function fetchRealRoute(m: NavMachine, from: LatLon, candidate: string | null) {
    const to = destLock.pick(from)
    destinationPoint.value = to
    if (candidate !== null && rerouteFails.value) {
      note('（模擬）重算失敗，帶你回原路線')
      giveRoute(m, null)
      return
    }
    const planned = candidate === null ? preplanned : null
    preplanned = null
    if (planned && distanceM(from, planned.from) <= PLAN_REUSE_M) {
      const reuse = planned.route
      routeInfo.value = reuse
      routeError.value = ''
      note(`沿用規劃好的路（${reuse.id}）${reuse.distanceM} 公尺，約 ${Math.round(reuse.durationS / 60)} 分鐘`)
      giveRoute(m, reuse)
      return
    }
    try {
      const routing = opts.routing
      // 走到一半重新規劃要快：quick 不另外找繞行路線
      const plan = await fetchRoutePlan(from, to, legMode.value, routing?.audience() ?? 'visitor', {
        simulate: routing?.simulate?.() ?? null,
        quick: candidate !== null,
      })
      if (machine !== m) return
      const route = plan.routes[0]!
      routeInfo.value = route
      routeError.value = ''
      note(
        `路線（${legMode.value}→${route.id}${plan.fallback ? '，後端失敗改用公開伺服器' : ''}）${route.distanceM} 公尺，` +
          `約 ${Math.round(route.durationS / 60)} 分鐘，階梯 ${route.stairsCount} 段${route.reasons.length ? `，${route.reasons.join('、')}` : ''}`,
      )
      giveRoute(m, route)
    } catch (err) {
      if (machine !== m) return
      routeError.value = `取得路線失敗：${(err as Error).message}`
      note(routeError.value)
      giveRoute(m, null)
    }
  }

  function giveRoute(m: NavMachine, r: NavRoute | null) {
    recorder?.route(r)
    m.routeResult(r)
  }

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

  /** 重新定位：忘掉舊的朝向、重新接上羅盤與 GPS、重新取得螢幕常亮 */
  function recalibrate(reason: 'manual' | 'resumed') {
    if (!machine || !source) return
    note(`重新定位：${RESYNC_TEXT[reason]}`)
    machine.resync()
    source.resync?.()
    void wake.on()
    lastTickAt = Date.now()
  }

  function setManualHeading(on: boolean, deg = manualHeading.value) {
    useManualHeading.value = on
    manualHeading.value = ((deg % 360) + 360) % 360
    if (on) machine?.onHeading(manualHeading.value)
  }

  // ── 模擬 GPS：搖桿、點地圖、鍵盤 ──────────────────
  const joyForwardDeg = () => (joyFrame.value === 'map' ? 0 : (view.value?.headingDeg ?? 0))
  let joy: JoystickVector = { forward: 0, right: 0, knobX: 0, knobY: 0 }
  let lastJoyEmitAt = 0
  function onJoystick(v: JoystickVector) {
    const wasMoving = joy.forward !== 0 || joy.right !== 0
    joy = v
    if (wasMoving && v.forward === 0 && v.right === 0) manual?.emitNow()
  }
  // 按住時每 100 ms 依推的程度移動，位置每 500 ms 送出一次（接近真實 GPS 的頻率）
  const joyTimer = window.setInterval(() => {
    if (!manual || (joy.forward === 0 && joy.right === 0)) return
    const m = simSpeed.value * 0.1
    manual.step(joyForwardDeg(), joy.forward * m, joy.right * m, { emit: false })
    simHere.value = manual.position
    const now = Date.now()
    if (now - lastJoyEmitAt >= 500) {
      lastJoyEmitAt = now
      manual.emitNow()
    }
  }, 100)

  function simPick(p: LatLon) {
    manual?.moveTo(p)
  }

  function onKey(e: KeyboardEvent) {
    if (!running.value) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    const moves: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const mv = moves[e.key]
    if (mv && manual) {
      e.preventDefault()
      manual.step(joyForwardDeg(), mv[0] * KEY_STEP_M, mv[1] * KEY_STEP_M)
      return
    }
    // Q／E：手動朝向左右轉 15°（電腦上沒有羅盤時用）
    if (e.key === 'q' || e.key === 'e') setManualHeading(true, manualHeading.value + (e.key === 'q' ? -15 : 15))
  }

  // ── 軌跡 ─────────────────────────────────────────
  const traceJson = () => JSON.stringify(recorder?.toJSON() ?? null)
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
      note('軌跡已複製')
    } catch {
      note('無法複製，請改用下載')
    }
  }

  // ── 回到前景 ─────────────────────────────────────
  function onVisibility() {
    if (document.visibilityState === 'visible' && running.value) recalibrate('resumed')
  }
  function onPageShow(e: PageTransitionEvent) {
    if (e.persisted && running.value) recalibrate('resumed')
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('keydown', onKey)

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

  /** 結束導航，清掉畫面狀態 */
  function stop() {
    stopAll()
    view.value = null
    active.value = null
  }

  onBeforeUnmount(() => {
    stopAll()
    window.clearInterval(joyTimer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('keydown', onKey)
  })

  return {
    view,
    simHere,
    running,
    active,
    routeInfo,
    legMode,
    routeError,
    permissionNote,
    wakeNote,
    log,
    simGps,
    joyFrame,
    simSpeed,
    simNote,
    rerouteFails,
    useManualHeading,
    manualHeading,
    destinationPoint,
    gpsCourse,
    courseDiff,
    traceCount,
    begin,
    restart,
    stop,
    recalibrate,
    setManualHeading,
    onJoystick,
    simPick,
    downloadTrace,
    copyTrace,
  }
}

export type NavSession = ReturnType<typeof useNavSession>
