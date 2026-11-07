/**
 * 共用箭頭（shared element）的位置。
 * .hero 是 position: absolute 的方塊（邊長 = size），只動 transform → 全程走合成器，不觸發排版。
 * 拆兩層：外層 .hero 管位置與大小（translate + scale），內層 .hero-arrow 管箭頭角度與比例（rotate + scale）。
 * （首頁與導航的箭頭大小比例不同，用 k 調整。）
 */
export interface Pose {
  /** 方塊左上角（未縮放前）的 px 位置 */
  x: number
  y: number
  /** 整個方塊的縮放 */
  s: number
  /** 箭頭角度，可超過 360（累加，走最短方向） */
  r: number
  /** 箭頭在方塊內的比例 */
  k: number
}

/** 首頁／開場：logo 箭頭在方塊內的比例 */
export const K_LOGO = 0.62
/** 導航：箭頭放大 */
export const K_NAV = 0.95

export const outerT = (p: Pose): string =>
  `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) scale(${p.s.toFixed(4)})`
export const innerT = (p: Pick<Pose, 'r' | 'k'>): string => `rotate(${p.r.toFixed(2)}deg) scale(${p.k.toFixed(4)})`

/** 讓 size 大小的方塊中心對準 el 的中心，縮放成 el 的寬度 */
export function poseAt(el: HTMLElement, size: number, r: number, k: number): Pose {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2 - size / 2, y: b.top + b.height / 2 - size / 2, s: b.width / size, r, k }
}

/** 畫面正中央 */
export function poseCenter(size: number, s: number, r: number, k: number): Pose {
  return { x: window.innerWidth / 2 - size / 2, y: window.innerHeight / 2 - size / 2, s, r, k }
}

/** 導航箭頭方塊邊長：寬的 58%、高的 36%，最大 280 px */
export const heroSize = (): number => Math.round(Math.min(window.innerWidth * 0.58, window.innerHeight * 0.36, 280))

/**
 * 系統要求減少動態時跳過過場。Windows「顯示動畫」關掉、Android「移除動畫」打開都會觸發；
 * Demo 想強制播放可在網址加 ?motion=1。
 */
export const reducedMotion = (): boolean =>
  !new URLSearchParams(location.search).has('motion') &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 把角度差折到 -180–180，用來決定最短旋轉方向 */
export const shortestDelta = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180
