/**
 * 捷運快照 metro_index.json 的型別與格式檢查，逐字對應 docs/arrow-nav/03-contracts.md「公車＋捷運規劃」。
 *
 * 資料：TDX 臺北捷運（Station、StationOfLine、Line、S2STravelTime、LineTransfer、StationExit、Frequency），
 * 由 scripts/build_metro_index.py 產生。TDX 讀不到的欄位會用預設值，記在 defaults。
 */
import type { BilingualName } from '@/lib/contract'

export interface MetroLine {
  lineId: string
  name: BilingualName
  /** #RRGGBB */
  color: string
  /** 平均班距（秒），候車估 headwayS / 2 */
  headwayS: number
}

export interface MetroExit {
  exitId: string
  name: string
  lat: number
  lon: number
  elevator: boolean | null
}

export interface MetroStation {
  /** TDX StationID；同一個實體車站在不同路線有不同 id，用 transfers 連起來 */
  stationId: string
  name: BilingualName
  lat: number
  lon: number
  /** 沒有出口資料時是 []，改用車站座標 */
  exits: MetroExit[]
}

export interface MetroPattern {
  lineId: string
  headsign: BilingualName
  /** stationId，依行駛順序 */
  stops: string[]
  /** runS[i]：stops[i] → stops[i+1] 的行車加停站秒數，長度 stops.length - 1 */
  runS: number[]
  /** 每站往這個方向的首班、末班（秒，營運日從 04:00 算，00:10 記成 24:10）；最後一站或沒有資料是 null */
  firstS?: (number | null)[]
  lastS?: (number | null)[]
}

export interface MetroTransfer {
  from: string
  to: string
  walkS: number
}

export interface MetroIndex {
  updatedAt: string
  /** 哪些欄位用了預設值，例如 ["runS", "exits"] */
  defaults: string[]
  lines: MetroLine[]
  stations: MetroStation[]
  patterns: MetroPattern[]
  transfers: MetroTransfer[]
}

const COLOR = /^#[0-9A-Fa-f]{6}$/

/** 回傳格式錯誤清單；空陣列表示符合合約 */
export function checkMetroIndex(d: MetroIndex): string[] {
  const errors: string[] = []
  const lineIds = new Set(d.lines.map((l) => l.lineId))
  const stationIds = new Set(d.stations.map((s) => s.stationId))

  d.lines.forEach((l, i) => {
    if (!COLOR.test(l.color)) errors.push(`lines[${i}].color must be #RRGGBB`)
    if (!(l.headwayS > 0)) errors.push(`lines[${i}].headwayS must be > 0`)
  })

  d.stations.forEach((s, i) => {
    if (!(s.lat > 21 && s.lat < 26.5 && s.lon > 119 && s.lon < 122.5)) errors.push(`stations[${i}] ${s.stationId} outside Taiwan`)
  })

  d.patterns.forEach((p, i) => {
    if (!lineIds.has(p.lineId)) errors.push(`patterns[${i}].lineId unknown line ${p.lineId}`)
    if (p.stops.length < 2) errors.push(`patterns[${i}].stops needs at least 2 stations`)
    p.stops.forEach((uid, j) => {
      if (!stationIds.has(uid)) errors.push(`patterns[${i}].stops[${j}] unknown station ${uid}`)
    })
    if (p.runS.length !== p.stops.length - 1) errors.push(`patterns[${i}].runS length ${p.runS.length}, expected ${p.stops.length - 1}`)
    if (p.runS.some((s) => !(s > 0))) errors.push(`patterns[${i}].runS must all be > 0`)
  })

  const pairs = new Set(d.transfers.map((t) => `${t.from}>${t.to}`))
  d.transfers.forEach((t, i) => {
    if (!stationIds.has(t.from)) errors.push(`transfers[${i}].from unknown station ${t.from}`)
    if (!stationIds.has(t.to)) errors.push(`transfers[${i}].to unknown station ${t.to}`)
    if (!pairs.has(`${t.to}>${t.from}`)) errors.push(`transfers[${i}] ${t.from}→${t.to} has no reverse entry`)
  })

  return errors
}

export const METRO_INDEX_URL = '/lab/metro_index.json'
let cached: Promise<MetroIndex | null> | null = null

/**
 * 第一次規劃時才下載捷運快照（約 60 KB）。讀不到或格式不對時回傳 null：
 * 規劃器只用公車，畫面上「只搭捷運」分頁顯示沒有路線，不會整個失敗。
 */
export function loadMetroIndex(): Promise<MetroIndex | null> {
  if (!cached) {
    cached = fetch(METRO_INDEX_URL)
      .then((res) => (res.ok ? (res.json() as Promise<MetroIndex>) : null))
      .then((data) => (data && checkMetroIndex(data).length === 0 ? data : null))
      .catch(() => null)
      .then((data) => {
        if (!data) cached = null
        return data
      })
  }
  return cached
}
