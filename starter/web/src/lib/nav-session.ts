/**
 * 把隊伍的導航引擎（web/src/nav、web/src/sensors）接到原型的導航畫面。
 *
 * - 真實模式：WebSensorSource（手機 GPS＋羅盤）。
 * - 模擬模式（沒有定位、桌機、投影 Demo）：ReplaySensorSource 沿著真實路線自動前進；
 *   有羅盤就用真的羅盤，沒有時以「行進方向」當朝向，所以轉彎前箭頭會先偏向轉彎方向、轉過去後回正。
 *
 * 引擎本身不放計時器：這裡每秒呼叫 tick()，並處理重新規劃（fetchRoute effect）與重新接上感測器。
 */
import { createAnnouncer, type Cue } from '@team/nav/announcer'
import { NAV_CONFIG } from '@team/nav/config'
import { bearingDeg, distanceM } from '@team/nav/geo'
import { createNavMachine, type NavRoute, type NavView } from '@team/nav/machine'
import { ReplaySensorSource } from '@team/sensors/replay'
import type { SensorSource } from '@team/sensors/source'
import { WebSensorSource } from '@team/sensors/web'
import { WakeLockHolder } from '@team/sensors/wakelock'
import type { LatLon } from '@team/lib/contract'

export type { NavRoute, NavView, Cue }

export interface NavSessionOptions {
  route: NavRoute
  simulate: boolean
  /** 走偏時重新規劃：從 from 到目的地；失敗回 null（引擎會帶人回原路線） */
  replan(from: LatLon): Promise<NavRoute | null>
  onView(v: NavView): void
  onCue(c: Cue): void
}

export interface NavSession {
  stop(): void
}

/** 模擬模式整段路大約走多久（秒）：太慢 Demo 等不完，太快看不到箭頭轉 */
const DEMO_TRIP_S = 30

function routeLengthM(g: LatLon[]) {
  let m = 0
  for (let i = 1; i < g.length; i++) m += distanceM(g[i - 1]!, g[i]!)
  return m
}

export async function startNavSession(opts: NavSessionOptions): Promise<NavSession> {
  const compass = new WebSensorSource({ position: false })
  let replay: ReplaySensorSource | null = null
  let source: SensorSource
  if (opts.simulate) {
    const speedMps = Math.min(15, Math.max(1.4, routeLengthM(opts.route.geometry) / DEMO_TRIP_S))
    replay = new ReplaySensorSource({ geometry: opts.route.geometry, speedMps, headingSource: compass, accuracyM: 6 })
    source = replay
  } else {
    source = new WebSensorSource()
  }

  // iOS 羅盤權限要在使用者點擊的流程內要（「開始帶路」按鈕）
  await source.requestPermission()

  // 模擬模式沒有真的羅盤時（桌機），用行進方向當朝向
  const sim = opts.simulate
  let lastCompassAt = 0
  let lastPos: LatLon | null = null
  let travelDeg: number | null = null

  const machine = createNavMachine({ route: opts.route, courseCheck: !sim })
  const announcer = createAnnouncer()
  let stopped = false

  machine.subscribe(v => {
    opts.onView(v)
    announcer.update(v).forEach(opts.onCue)
  })
  machine.onEffect(async e => {
    const r = await opts.replan(e.from).catch(() => null)
    if (!stopped) machine.routeResult(r)
  })
  machine.onResync(() => source.resync?.())

  machine.start()
  source.start({
    onHeading: d => { lastCompassAt = Date.now(); machine.onHeading(d) },
    onPosition: p => {
      const here: LatLon = [p.lat, p.lon]
      if (sim && lastPos && distanceM(lastPos, here) > 0.5) travelDeg = bearingDeg(lastPos, here)
      lastPos = here
      machine.onPosition(p)
    },
    // 模擬模式沒有羅盤是預期中的（改用行進方向），不要讓引擎因此整段隱藏箭頭
    onError: c => { if (!(sim && c === 'no_heading_sensor')) machine.onError(c) },
  })

  const timer = setInterval(() => {
    if (sim && Date.now() - lastCompassAt > 1500) {
      // 模擬的朝向是真北，引擎吃磁北（會自己加磁偏角），所以先扣掉
      const trueDeg = travelDeg ?? (opts.route.geometry.length > 1 ? bearingDeg(opts.route.geometry[0]!, opts.route.geometry[1]!) : 0)
      machine.onHeading(trueDeg - NAV_CONFIG.declinationDeg)
    }
    machine.tick()
  }, sim ? 250 : 1000)

  const wake = new WakeLockHolder()
  void wake.on()

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      source.stop()
      void wake.off()
    },
  }
}
