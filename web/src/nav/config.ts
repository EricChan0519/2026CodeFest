/**
 * 導航參數，起始值見 docs/arrow-nav/04-nav-logic.md#參數。
 * 全部要用戶外實測調整，只改這個檔案。
 */
export const NAV_CONFIG = {
  /** 路線上的前視距離（公尺） */
  lookaheadM: 20,
  /** 朝向平滑時間常數（毫秒）：依事件間隔換算係數，60 Hz 時約等於舊的每筆 0.2。這是「正在轉」時的最快值 */
  headingTauMs: 80,
  /** 朝向很穩定（跟目前差距很小）時用的時間常數（毫秒）：愈穩愈慢，壓住雜訊造成的抖動 */
  headingSlowTauMs: 350,
  /** 與目前朝向差距小於此角度時，時間常數從 headingTauMs 線性過渡到 headingSlowTauMs */
  headingSlowBandDeg: 25,
  /** 單筆朝向與目前差超過此角度，先當成突波，連續確認才採用（度） */
  headingSpikeDeg: 60,
  /** 突波要連續幾筆彼此一致才算真的轉過去 */
  headingSpikeConfirm: 2,
  /** 突波確認的時間窗（毫秒），超過就重新計 */
  headingSpikeWindowMs: 600,
  /** 超過此時間沒有朝向事件，下一筆直接採用不平滑（毫秒），回到前景後不會慢慢轉過來 */
  headingGapResetMs: 1500,
  /** 輸出的死區（度）：平滑值與目前輸出差距小於此值就不動，避免微抖 */
  headingDeadbandDeg: 1.5,
  /** 超過此時間沒有朝向事件，自動重新接上感測器（秒）。要小於 headingLostS 才來得及 */
  headingStaleS: 2,
  /** 朝向原始值完全沒變超過此時間（真實感測器一定會有微小變化），判定感測器卡住並重新接上（秒） */
  headingFrozenS: 6,
  /** 自動重新接上感測器的最短間隔（秒） */
  resyncCooldownS: 5,
  /** 走路方向檢查：定位精度要好於此值才採樣（公尺） */
  courseMaxAccuracyM: 20,
  /** 走路方向檢查：兩次採樣點至少相距（公尺），實際門檻還要大於 1.5 × 精度 */
  courseMinMoveM: 10,
  /** 走路方向檢查：速度範圍（公尺/秒），太慢是站著飄，太快是搭車 */
  courseMinSpeedMps: 0.8,
  courseMaxSpeedMps: 3.5,
  /** 取樣期間朝向的一致程度（0–1），低於此值表示邊走邊轉，不採樣 */
  courseMinConsistency: 0.9,
  /** 連續幾次採樣一致偏差才下判斷 */
  courseSamples: 3,
  /** 羅盤與 GPS 走向差超過此角度視為「可能不準」（度） */
  courseMismatchDeg: 45,
  /** 差距小於此角度視為「正常」（度） */
  courseOkDeg: 25,
  /** 幾次採樣之間差距的最大離散（度），太散就不下判斷 */
  courseSpreadDeg: 30,
  /** 因方向檢查觸發重新定位的最短間隔（秒） */
  courseResyncCooldownS: 60,
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

/**
 * 離轉彎點多近就算通過：max(8, 0.5 × accuracy)。
 * 通過後目標點改成下一段的前視點，不會退回（04「箭頭依路徑轉彎」）。
 */
export const turnPassM = (accuracyM: number): number => Math.max(8, 0.5 * accuracyM)
