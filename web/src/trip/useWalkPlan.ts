/**
 * 「怎麼去」畫面的步行路線：選好目的地就依使用者的路線模式向後端要路線（推薦的路＋最快的路），
 * 讓使用者在出發前看到這條路好在哪、多走多久，再決定走哪一條。
 * 導航開始時起點沒有走遠，就直接用這裡算好的那條（useNavSession 的 preplanned）。
 */
import { ref, shallowRef } from 'vue'
import type { Audience, LatLon, RouteMode } from '@/lib/contract'
import type { Locator } from '@/lib/locator'
import { fetchRoutePlan } from '@/lib/modeRoute'
import type { RoutePlan } from '@/lib/modeRoute'

export function useWalkPlan(
  locator: Locator,
  opts: { mode: () => RouteMode; audience: () => Audience; simulate?: () => 'night' | null },
) {
  const plan = shallowRef<RoutePlan | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  let seq = 0

  async function planTo(target: LatLon) {
    const my = ++seq
    plan.value = null
    failed.value = false
    loading.value = true
    try {
      const from = await locator.current()
      if (my !== seq || !from) return
      const p = await fetchRoutePlan(from, target, opts.mode(), opts.audience(), { simulate: opts.simulate?.() ?? null })
      if (my === seq) plan.value = p
    } catch {
      if (my === seq) failed.value = true
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function clear() {
    seq++
    plan.value = null
    loading.value = false
    failed.value = false
  }

  return { plan, loading, failed, planTo, clear }
}

export type WalkPlan = ReturnType<typeof useWalkPlan>
