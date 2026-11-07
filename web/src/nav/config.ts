/**
 * 導航參數，起始值見 docs/arrow-nav/04-nav-logic.md#參數。
 * 全部要用戶外實測調整，只改這個檔案。
 */
export const NAV_CONFIG = {
  /** 路線上的前視距離（公尺） */
  lookaheadM: 20,
  /** 朝向平滑時間常數（毫秒）：依事件間隔換算係數，60 Hz 時約等於舊的每筆 0.2 */
  headingTauMs: 80,
  /** 畫面上箭頭追目標角度的時間常數（毫秒），每一幀內插 */
  arrowTauMs: 50,
  /** 磁偏角：臺北約 -4.7°（待實測）。真北朝向 = 磁北朝向 + 磁偏角 */
  declinationDeg: -4.7,
  /** 連續幾次進入抵達範圍才算抵達 */
  arriveHits: 2,
  /** 連續幾次偏離才算偏離 */
  offRouteHits: 3,
  /** 重新規劃的最短間隔（秒） */
  rerouteCooldownS: 20,
  /** 精度差於此值算訊號弱（公尺） */
  weakAccuracyM: 50,
  /** 超過此時間沒有位置更新算訊號弱（秒） */
  staleGpsS: 15,
  /** 超過此時間沒有朝向事件，進入「沒有羅盤資料」（秒） */
  headingLostS: 3,
  /** 轉彎前多遠開始提示（公尺） */
  announceBeforeTurnM: 30,
  /** 同一句話的靜音時間（秒） */
  repeatMuteS: 10,
  /** 投影到路線時，只往前找這麼遠（公尺），避免跳回走過的路 */
  searchAheadM: 100,
} as const

export type NavConfig = typeof NAV_CONFIG

/** 抵達範圍：max(15, accuracy) */
export const arriveRadiusM = (accuracyM: number): number => Math.max(15, accuracyM)

/** 偏離距離：max(30, 1.5 × accuracy) */
export const offRouteM = (accuracyM: number): number => Math.max(30, 1.5 * accuracyM)
