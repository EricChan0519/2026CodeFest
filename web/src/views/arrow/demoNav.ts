/**
 * UI 展示用的假導航（還沒接真的導航引擎）。
 * 沿三段路「走」，產生和 NavView 類似的欄位：狀態、箭頭角度、剩餘距離、下一個轉彎。
 * 整合時整個換成 nav/machine.ts 的 subscribe(view)。
 */
export type DemoState = 'navigating' | 'weak_signal' | 'rerouting' | 'back_to_route' | 'arrived'
export type TurnKind = 'straight' | 'bear_left' | 'bear_right' | 'left' | 'right' | 'turn_around'

export interface DemoView {
  state: DemoState
  /** 箭頭相對手機上緣的角度 */
  arrowDeg: number
  remainingM: number
  /** back_to_route：離路線多遠 */
  offRouteM: number
  next: { kind: TurnKind; distanceM: number; street: string } | null
}

const LEGS = [
  { bearing: 8, len: 140, street: '天母東路' },
  { bearing: 96, len: 190, street: '中山北路七段' },
  { bearing: 14, len: 120, street: '天母西路' },
]
const TOTAL = LEGS.reduce((s, l) => s + l.len, 0)

function turnKind(from: number, to: number): TurnKind {
  const d = ((((to - from) % 360) + 540) % 360) - 180
  const a = Math.abs(d)
  if (a < 15) return 'straight'
  if (a < 45) return d > 0 ? 'bear_right' : 'bear_left'
  if (a < 150) return d > 0 ? 'right' : 'left'
  return 'turn_around'
}

export function createDemoNav(onView: (v: DemoView) => void) {
  let along = 0
  let t = 0
  let speed = 6 // m/s，快轉
  let steer = 0 // 搖桿左右：手機朝向偏移（度）
  let push = 1 // 搖桿前後：速度倍率
  let forced: DemoState | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let last = 0

  function compute(): DemoView {
    let i = 0
    let start = 0
    while (i < LEGS.length - 1 && along >= start + LEGS[i].len) start += LEGS[i++].len
    const leg = LEGS[i]
    const toTurn = start + leg.len - along
    const heading = leg.bearing + 5 * Math.sin(t * 0.7) + 2 * Math.sin(t * 2.3) + steer
    const nextLeg = LEGS[i + 1]
    const target = nextLeg && toTurn < 22 ? nextLeg.bearing : leg.bearing
    const remainingM = Math.max(0, TOTAL - along)
    const state: DemoState = forced ?? (remainingM <= 0 ? 'arrived' : 'navigating')

    if (state === 'arrived') return { state, arrowDeg: 0, remainingM: 0, offRouteM: 0, next: null }
    if (state === 'back_to_route')
      return { state, arrowDeg: 115 - (heading - leg.bearing), remainingM, offRouteM: 24, next: null }
    return {
      state,
      arrowDeg: target - heading,
      remainingM,
      offRouteM: 0,
      next: nextLeg ? { kind: turnKind(leg.bearing, nextLeg.bearing), distanceM: toTurn, street: nextLeg.street } : null,
    }
  }

  function step() {
    const now = performance.now()
    const dt = Math.min(0.5, (now - last) / 1000)
    last = now
    t += dt
    if (forced === null) along = Math.min(TOTAL, along + speed * push * dt)
    onView(compute())
  }

  return {
    start() {
      along = 0
      t = 0
      forced = null
      steer = 0
      push = 1
      last = performance.now()
      clearInterval(timer)
      timer = setInterval(step, 100)
      step()
    },
    stop() {
      clearInterval(timer)
      timer = undefined
    },
    /** null = 自動 */
    force(s: DemoState | null) {
      forced = s
      if (s === 'arrived') along = TOTAL
      if (s === null && along >= TOTAL) along = 0
      onView(compute())
    },
    setSpeed(mps: number) {
      speed = mps
    },
    joystick(v: { forward: number; right: number }) {
      steer = v.right * 90
      push = 1 + v.forward
    },
  }
}
