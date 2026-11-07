import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 裝置朝向（度，0–360，順時針）。沒有感測器（桌機瀏覽器）時維持 null。
 * 只拿來算「轉了多少」，所以 Android 的相對 alpha 也能用。
 */
export function useHeading() {
  const heading = ref<number | null>(null)

  function onOrient(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
    if (typeof e.webkitCompassHeading === 'number') heading.value = e.webkitCompassHeading // iOS（已做傾斜補償）
    else if (e.alpha != null && e.beta != null && e.gamma != null) heading.value = tiltCompensated(e.alpha, e.beta, e.gamma)
    else if (e.alpha != null) heading.value = (360 - e.alpha) % 360
  }

  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
  onMounted(() => window.addEventListener(eventName, onOrient as EventListener))
  onBeforeUnmount(() => window.removeEventListener(eventName, onOrient as EventListener))

  return heading
}

/**
 * 用 alpha/beta/gamma 算「手機頂端朝向」的方位角（W3C DeviceOrientation 規格的公式）。
 * 只用 alpha 時，手機直立或走路傾斜會亂跳；補償後拿著手機邊走邊看也穩定。
 */
function tiltCompensated(alpha: number, beta: number, gamma: number) {
  const d = Math.PI / 180
  const cY = Math.cos(gamma * d), cZ = Math.cos(alpha * d)
  const sX = Math.sin(beta * d), sY = Math.sin(gamma * d), sZ = Math.sin(alpha * d)
  const vx = -cZ * sY - sZ * sX * cY
  const vy = -sZ * sY + cZ * sX * cY
  let h = Math.atan(vx / vy)
  if (vy < 0) h += Math.PI
  else if (vx < 0) h += 2 * Math.PI
  return h / d
}

/** iOS 13+ 必須在使用者點擊的當下要權限 → 在「開始導航」的 click handler 裡呼叫。 */
export function requestCompassPermission() {
  const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => { /* 拒絕時箭頭維持固定方向 */ })
}
