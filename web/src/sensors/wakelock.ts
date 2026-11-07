/**
 * 螢幕常亮（Wake Lock API）。回到前景（visibilitychange）時重新取得。
 * 取不到不影響導航；備案是 screen_awake Handler（見 03 合約）。
 */
interface WakeLockSentinelLike {
  release(): Promise<void>
}

export class WakeLockHolder {
  private sentinel: WakeLockSentinelLike | null = null
  private wanted = false
  private readonly onVisible = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire()
  }

  /** 目前是否持有 */
  get held(): boolean {
    return this.sentinel !== null
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator
  }

  async on(): Promise<boolean> {
    this.wanted = true
    document.addEventListener('visibilitychange', this.onVisible)
    return this.acquire()
  }

  async off(): Promise<void> {
    this.wanted = false
    document.removeEventListener('visibilitychange', this.onVisible)
    const s = this.sentinel
    this.sentinel = null
    try {
      await s?.release()
    } catch {
      /* 已被系統釋放 */
    }
  }

  private async acquire(): Promise<boolean> {
    if (!this.supported || this.sentinel) return this.held
    try {
      const nav = navigator as Navigator & {
        wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike & EventTarget> }
      }
      const s = await nav.wakeLock.request('screen')
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null
      })
      this.sentinel = s
    } catch {
      this.sentinel = null
    }
    return this.held
  }
}
