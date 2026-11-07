/**
 * 朝向濾波：把羅盤原始值變成穩定的朝向。純函式風格，沒有計時器、沒有 DOM。
 * 處理三種雜訊：
 * 1. 一般抖動：平滑時間常數依「跟目前差多少」調整，穩定時很慢（壓抖動），轉彎時很快（不拖尾）。
 * 2. 突波：單筆偏離超過 headingSpikeDeg，先不採用；連續 headingSpikeConfirm 筆彼此一致才算真的轉過去。
 * 3. 斷訊後恢復（回到前景、感測器重接）：隔太久的第一筆直接採用，不從舊值慢慢轉過來。
 * 輸出再加一個死區，差距太小就不動。
 */
import { alphaForDt, smoothHeading } from './arrow'
import type { HeadingVec } from './arrow'
import type { NavConfig } from './config'
import { angleDiff } from './geo'

export type HeadingFilterConfig = Pick<
  NavConfig,
  | 'headingTauMs'
  | 'headingSlowTauMs'
  | 'headingSlowBandDeg'
  | 'headingSpikeDeg'
  | 'headingSpikeConfirm'
  | 'headingSpikeWindowMs'
  | 'headingGapResetMs'
  | 'headingDeadbandDeg'
>

export interface HeadingFilter {
  /** 餵一筆原始朝向（0–360，任何一致的參考北都可以），回傳濾波後的朝向 */
  update(deg: number, now: number): number
  /** 忘掉目前的值，下一筆直接採用 */
  reset(): void
  /** 目前輸出，還沒有資料時為 null */
  readonly value: number | null
}

export function createHeadingFilter(cfg: HeadingFilterConfig): HeadingFilter {
  let vec: HeadingVec | null = null
  let out: number | null = null
  let lastAt: number | null = null
  let pending: { deg: number; count: number; since: number } | null = null

  function adopt(deg: number, now: number): number {
    vec = smoothHeading(null, deg, 1)
    out = vec.deg
    lastAt = now
    pending = null
    return out
  }

  return {
    update(deg, now) {
      if (vec === null || out === null || lastAt === null || now - lastAt > cfg.headingGapResetMs) {
        return adopt(deg, now)
      }

      const diff = Math.abs(angleDiff(deg, vec.deg))
      if (diff > cfg.headingSpikeDeg) {
        if (
          pending &&
          now - pending.since <= cfg.headingSpikeWindowMs &&
          Math.abs(angleDiff(deg, pending.deg)) < cfg.headingSpikeDeg / 2
        ) {
          pending = { deg, count: pending.count + 1, since: pending.since }
        } else {
          pending = { deg, count: 1, since: now }
        }
        if (pending.count < cfg.headingSpikeConfirm) return out // 先不理這一筆
        return adopt(deg, now) // 連續確認：真的轉過去了
      }
      pending = null

      const band = Math.max(1, cfg.headingSlowBandDeg)
      const stability = Math.max(0, 1 - diff / band) // 1 = 很穩，0 = 正在大幅轉動
      const tau = cfg.headingTauMs + (cfg.headingSlowTauMs - cfg.headingTauMs) * stability
      vec = smoothHeading(vec, deg, alphaForDt(now - lastAt, tau))
      lastAt = now
      if (Math.abs(angleDiff(vec.deg, out)) >= cfg.headingDeadbandDeg) out = vec.deg
      return out
    },
    reset() {
      vec = null
      out = null
      lastAt = null
      pending = null
    },
    get value() {
      return out
    },
  }
}
