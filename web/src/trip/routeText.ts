/**
 * 「怎麼去」裡步行路線的說明文字：
 * - 推薦的路（和最快不同）：說出比最快路線好在哪（後端的原因代碼＋diff 的數字），最後是多走幾分鐘。
 * - 最快路線、或沒有更合適的路：說出這條路本身有什麼（沿路幾支監視器、幾家便利商店、有沒有階梯）。
 * 數字一律來自 API，沒有資料（null）就不說（docs/arrow-nav/02-route-candidates.md 的用詞規則）。
 */
import type { RouteMode } from '@/lib/contract'
import type { ModeRoute } from '@/lib/modeRoute'
import { fill } from '@/i18n/arrow'
import type { ReasonKey, RouteModeStrings } from '@/i18n/routeMode'

const REASON_KEYS: ReasonKey[] = [
  'fewer_steps',
  'flatter',
  'gentler_slope',
  'brighter',
  'more_cameras',
  'near_police',
  'more_stores',
  'more_shops',
  'fewer_alleys',
  'main_roads',
  'extra_time',
]
const isReason = (k: string): k is ReasonKey => (REASON_KEYS as string[]).includes(k)

/** 推薦的路比最快路線好在哪；多走的時間放最後。最多 max 項（不含多走時間） */
export function reasonTexts(route: ModeRoute, s: RouteModeStrings, max = 3): string[] {
  const d = route.diff
  const n: Partial<Record<ReasonKey, number>> = {
    fewer_steps: d?.steps ?? undefined,
    flatter: d?.climbM != null ? Math.round(d.climbM) : undefined,
    more_cameras: d?.cameras ?? undefined,
    more_stores: d?.stores ?? undefined,
    extra_time: d ? Math.max(1, Math.round(d.durationS / 60)) : undefined,
  }
  const out: string[] = []
  for (const code of route.reasons) {
    if (!isReason(code) || code === 'extra_time' || out.length >= max) continue
    out.push(fill(s.reasons[code], { n: n[code] ?? '' }))
  }
  if (route.reasons.includes('extra_time') && n.extra_time) out.push(fill(s.reasons.extra_time, { n: n.extra_time }))
  return out
}

/** 這條路本身沿路有什麼，依模式挑相關的說 */
export function factTexts(route: ModeRoute, mode: RouteMode, s: RouteModeStrings): string[] {
  const m = route.metrics
  if (!m) return []
  const out: string[] = []
  if (mode === 'safe') {
    if (m.cameras) out.push(fill(s.facts.cameras, { n: m.cameras }))
    if (m.stores) out.push(fill(s.facts.stores, { n: m.stores }))
    if (m.policeNearby) out.push(s.facts.police)
  } else if (mode === 'gentle') {
    if (m.steps === 0) out.push(s.facts.noSteps)
    else if (m.steps) out.push(fill(s.facts.steps, { n: m.steps }))
    if (m.climbM != null) out.push(m.climbM >= 2 ? fill(s.facts.climb, { n: Math.round(m.climbM) }) : s.facts.flat)
  } else if (m.steps) {
    out.push(fill(s.facts.steps, { n: m.steps }))
  }
  return out
}

/** 一條步行路線在清單上的說明 */
export function routeDetail(route: ModeRoute, mode: RouteMode, s: RouteModeStrings): string {
  if (route.id === 'fastest' || !route.diff) return factTexts(route, mode, s).join(' · ')
  const lines = reasonTexts(route, s)
  // 平緩的路還是有階梯時要說（少走 1 段，不代表沒有）
  const steps = route.metrics?.steps
  if (mode === 'gentle' && steps) lines.splice(lines.length - (route.reasons.includes('extra_time') ? 1 : 0), 0, fill(s.facts.stepsLeft, { n: steps }))
  return lines.join(' · ')
}
