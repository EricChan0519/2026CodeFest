/**
 * 何時說話與震動。只吃 NavView、吐 Cue；句子由 i18n 依 key 產生，這裡不放文字。
 * 同一句話在 repeatMuteS 內不重複；每個轉彎只提示一次。
 * 見 docs/arrow-nav/04-nav-logic.md#語音與震動。
 */
import type { ManeuverKind } from '@/lib/contract'
import { NAV_CONFIG } from './config'
import type { NavConfig } from './config'
import type { NavState, NavView } from './machine'

export type CueKey =
  | 'start'
  | 'turn_ahead'
  | 'turn_around'
  | 'off_route'
  | 'weak_signal'
  | 'arrived'

export type HapticPattern = 'turn' | 'arrive' | 'warn'

export interface Cue {
  key: CueKey
  /** turn_ahead 才有：left、right、slight_left、slight_right、uturn、stairs */
  turn?: ManeuverKind
  haptic: HapticPattern | null
  /** 重要提示打斷目前的語音 */
  interrupt: boolean
}

export interface Announcer {
  /** 每次 NavView 更新時呼叫，回傳這次要播的提示（可能是空陣列） */
  update(view: NavView): Cue[]
  reset(): void
}

export function createAnnouncer(opts: { cfg?: NavConfig; now?: () => number } = {}): Announcer {
  const cfg = opts.cfg ?? NAV_CONFIG
  const clock = opts.now ?? Date.now

  let started = false
  let prevState: NavState | null = null
  let prevDirection: string | null = null
  const turnsDone = new Set<number>()
  const lastSpokenAt = new Map<string, number>()

  /** 同一句話在 repeatMuteS 內只說一次 */
  function allow(sig: string, now: number): boolean {
    const last = lastSpokenAt.get(sig)
    if (last !== undefined && now - last < cfg.repeatMuteS * 1000) return false
    lastSpokenAt.set(sig, now)
    return true
  }

  return {
    update(view) {
      const now = clock()
      const out: Cue[] = []
      const push = (cue: Cue, sig: string) => {
        if (allow(sig, now)) out.push(cue)
      }
      const enter = (s: NavState) => view.state === s && prevState !== s

      // 抵達：一次就好，之後什麼都不再說
      if (view.state === 'arrived') {
        if (enter('arrived')) push({ key: 'arrived', haptic: 'arrive', interrupt: true }, 'arrived')
        prevState = view.state
        return out
      }

      if (view.state === 'navigating' && !started && view.hasPosition) {
        started = true
        push({ key: 'start', haptic: null, interrupt: false }, 'start')
      }

      if (enter('rerouting')) turnsDone.clear() // 新路線的轉彎 index 會重編
      if (enter('rerouting') || (enter('back_to_route') && prevState !== 'rerouting')) {
        push({ key: 'off_route', haptic: 'warn', interrupt: true }, 'off_route')
      }
      if (enter('weak_signal')) {
        push({ key: 'weak_signal', haptic: 'warn', interrupt: false }, 'weak_signal')
      }

      if (view.state === 'navigating') {
        // 轉彎前 announceBeforeTurnM 內，每個轉彎只提示一次
        const t = view.nextTurn
        if (t && t.kind !== 'arrive' && t.distanceM <= cfg.announceBeforeTurnM && !turnsDone.has(t.index)) {
          turnsDone.add(t.index)
          push({ key: 'turn_ahead', turn: t.kind, haptic: 'turn', interrupt: true }, `turn_ahead:${t.index}`)
        }
        // 需要向後轉（剛變成向後轉時提示，不要每次更新都說）
        if (view.direction === 'turn_around' && prevDirection !== 'turn_around') {
          push({ key: 'turn_around', haptic: 'warn', interrupt: true }, 'turn_around')
        }
      }

      prevState = view.state
      prevDirection = view.direction
      return out
    },

    reset() {
      started = false
      prevState = null
      prevDirection = null
      turnsDone.clear()
      lastSpokenAt.clear()
    },
  }
}
