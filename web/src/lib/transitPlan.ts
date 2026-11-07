/**
 * 公車＋捷運規劃：輸入目的地後，在手機上算出「最快（混搭）」「只搭公車」「只搭捷運」三個分頁。
 *
 * 資料：TDX 公車路線停靠順序（stop_index.json）和 TDX 臺北／新北捷運（metro_index.json），都是政府開放資料快照。
 * 不呼叫外部規劃服務，關掉網路也能算。合約見 docs/arrow-nav/03-contracts.md「公車＋捷運規劃」。
 *
 * 做法：把站牌、捷運站當「月台」節點，每條路線每一站當「車上」節點，用 Dijkstra 找最短預估時間；
 * 狀態多帶一個「已經搭了幾段車」，最多 MAX_RIDES 段。時間全部是估計值，不是即時班表：
 * - 步行：直線距離 × DETOUR ÷ 步行速度（長者較慢）
 * - 公車：候車 BUS_WAIT_S、每站 BUS_STOP_S
 * - 捷運：候車 headwayS / 2、站間用 TDX 的 runS、站內換線用 TDX／預設的 walkS
 */
import type { Audience, LatLon, Station, StationRoute } from '@/lib/contract'
import type { RoutePattern } from '@/lib/directBus'
import type { MetroIndex, MetroLine, MetroPattern, MetroStation } from '@/lib/metroIndex'
import { TRANSFER_ANY_M, TRANSFER_SAME_NAME_M } from '@/lib/transferBus'
import { distanceM } from '@/nav/geo'
import type { Ride } from '@/nav/journey'

export type PlanTab = 'mixed' | 'bus' | 'metro'

export interface TransitPlan {
  /** [] 表示走路就到 */
  rides: Ride[]
  /** 預估總時間（秒），用來排序 */
  durationS: number
  walkS: number
  waitS: number
  rideS: number
  /** 全程步行公尺數（估算值，只用來顯示和排序） */
  walkM: number
  /**
   * 照現在的時間搭不搭得到：ended 末班車已過、not_started 首班車還沒開。
   * 快照沒有首末班資料的路線一律當作 ok。畫面上不是 ok 的方案反灰、不能選。
   */
  service: ServiceState
}

export type ServiceState = 'ok' | 'ended' | 'not_started'

export interface BusNetwork {
  stations: Station[]
  patterns: RoutePattern[]
}

/** 起點、終點最多走多遠（直線） */
export const MAX_WALK_M = 800
/**
 * 某個分頁在 800 公尺內找不到路時，起點、終點的步行範圍依序放寬；最後不設上限，
 * 離捷運 3 公里又沒有公車時，也要走過去搭捷運，不能直接說沒有路（步行時間照算）
 */
export const WIDER_WALK_M = [1500, 2500, Infinity]
export const MAX_RIDES = 3
/** 每個分頁最多幾筆搭車方案（mixed 另外加上走路） */
export const PLANS_PER_TAB = 5
/** 比這個近就建議走路 */
export const WALK_ONLY_M = 400
/** 直線距離換算成步行距離 */
export const DETOUR = 1.25
/** 步行速度（公尺／秒）；兒童、外籍人士約等於 transferBus 的 67 公尺／分鐘 */
export const WALK_MPS: Record<Audience, number> = { elder: 0.9, child: 1.1, visitor: 1.1 }
export const BUS_WAIT_S = 300
/** 市民小巴班次少（常是 20–30 分鐘一班），候車估久一點 */
export const MINIBUS_WAIT_S = 900
export const BUS_STOP_S = 90
/** 不拿來規劃的公車：觀光巴士要另外買票、通勤專車只在尖峰開（2026-11-07 用真實快照試算時被排進方案） */
export const EXCLUDED_BUS = /觀光巴士|通勤/
/** 公車站牌離捷運出口（沒有出口時是車站）多近可以互轉 */
export const BUS_METRO_TRANSFER_M = 300
/** 每多上一次車加的排序懲罰（不算進 durationS），避免為了省一兩分鐘多轉一次車 */
export const BOARD_PENALTY_S = 120

/** 營運日從清晨 4 點算起，和快照的首末班秒數一致（00:30 是 24:30） */
export const SERVICE_DAY_START_H = 4

interface Clock {
  /** 從營運日 0 點起的秒數 */
  nowS: number
  weekend: boolean
}

export function serviceClock(now: Date): Clock {
  const h = now.getHours()
  const late = h < SERVICE_DAY_START_H
  const day = (now.getDay() + (late ? 6 : 0)) % 7
  return { nowS: (late ? h + 24 : h) * 3600 + now.getMinutes() * 60 + now.getSeconds(), weekend: day === 0 || day === 6 }
}

export function metroUid(stationId: string): string {
  return `metro:${stationId}`
}

// ---------------------------------------------------------------- 圖

interface Platform {
  kind: 'bus' | 'metro'
  lat: number
  lon: number
  bus?: Station
  metro?: MetroStation
}

interface Pat {
  mode: 'bus' | 'metro'
  nodes: number[]
  hopS: number[]
  waitS: number
  noBoard: Set<number>
  noAlight: Set<number>
  offset: number
  bus?: RoutePattern
  metro?: MetroPattern
  line?: MetroLine
}

interface Xfer {
  to: number
  /** 要走的直線距離（站內換線是 0） */
  m: number
  /** 固定秒數（站內換線的 walkS） */
  s: number
}

interface Graph {
  platforms: Platform[]
  pats: Pat[]
  /** 車上節點總數 */
  onboard: number
  /** 每個月台在哪些路線的第幾站 */
  occ: [number, number][][]
  xfer: Xfer[][]
}

/** 月台到某點的距離與最近的入口：捷運有出口就只用出口，沒有才用車站中心 */
function nearestAccess(pl: Platform, p: LatLon): { m: number; point: LatLon; exit?: string } {
  const exits = pl.metro?.exits ?? []
  if (exits.length === 0) return { m: distanceM(p, [pl.lat, pl.lon]), point: [pl.lat, pl.lon] }
  let best = { m: Infinity, point: [pl.lat, pl.lon] as LatLon, exit: undefined as string | undefined }
  for (const e of exits) {
    const m = distanceM(p, [e.lat, e.lon])
    // 出口名稱 TDX 是「台北車站M3」，畫面和語音用代號（M3、1）比較短，也不分語言
    if (m < best.m) best = { m, point: [e.lat, e.lon], exit: e.exitId }
  }
  return best
}

const CELL = 0.003
function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`
}

function buildGraph(bus: BusNetwork, metro: MetroIndex | null): Graph {
  const platforms: Platform[] = []
  const busIdx = new Map<string, number>()
  for (const s of bus.stations) {
    busIdx.set(s.stationUid, platforms.length)
    platforms.push({ kind: 'bus', lat: s.lat, lon: s.lon, bus: s })
  }
  const metroIdx = new Map<string, number>()
  for (const s of metro?.stations ?? []) {
    metroIdx.set(s.stationId, platforms.length)
    platforms.push({ kind: 'metro', lat: s.lat, lon: s.lon, metro: s })
  }

  const pats: Pat[] = []
  let offset = 0
  for (const p of bus.patterns) {
    const nodes = p.stops.map((uid) => busIdx.get(uid) ?? -1)
    if (nodes.some((n) => n < 0) || nodes.length < 2 || EXCLUDED_BUS.test(p.routeName.zh)) continue
    const waitS = p.routeName.zh.includes('小巴') ? MINIBUS_WAIT_S : BUS_WAIT_S
    pats.push({ mode: 'bus', nodes, hopS: nodes.slice(1).map(() => BUS_STOP_S), waitS,
      noBoard: new Set(p.noBoard), noAlight: new Set(p.noAlight), offset, bus: p })
    offset += nodes.length
  }
  const lines = new Map((metro?.lines ?? []).map((l) => [l.lineId, l]))
  for (const p of metro?.patterns ?? []) {
    const nodes = p.stops.map((id) => metroIdx.get(id) ?? -1)
    const line = lines.get(p.lineId)
    if (nodes.some((n) => n < 0) || nodes.length < 2 || !line) continue
    pats.push({ mode: 'metro', nodes, hopS: p.runS, waitS: Math.round(line.headwayS / 2), noBoard: new Set(), noAlight: new Set(),
      offset, metro: p, line })
    offset += nodes.length
  }

  const occ: [number, number][][] = platforms.map(() => [])
  pats.forEach((p, pi) => p.nodes.forEach((n, i) => occ[n].push([pi, i])))

  const xfer: Xfer[][] = platforms.map(() => [])
  // 公車 ↔ 公車：任何 80 公尺內，或同名 300 公尺內（和 transferBus 相同）
  const grid = new Map<string, number[]>()
  platforms.forEach((pl, i) => {
    if (pl.kind !== 'bus') return
    const k = cellKey(pl.lat, pl.lon)
    grid.set(k, [...(grid.get(k) ?? []), i])
  })
  const around = (lat: number, lon: number): number[] => {
    const out: number[] = []
    const r = Math.floor(lat / CELL)
    const c = Math.floor(lon / CELL)
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(...(grid.get(`${r + dr}:${c + dc}`) ?? []))
    return out
  }
  platforms.forEach((a, i) => {
    if (a.kind !== 'bus') return
    for (const j of around(a.lat, a.lon)) {
      if (j === i) continue
      const b = platforms[j]
      const m = distanceM([a.lat, a.lon], [b.lat, b.lon])
      if (m <= TRANSFER_ANY_M || (m <= TRANSFER_SAME_NAME_M && a.bus!.name.zh === b.bus!.name.zh)) xfer[i].push({ to: j, m, s: 0 })
    }
  })
  // 公車 ↔ 捷運：站牌離出口 300 公尺內
  platforms.forEach((a, i) => {
    if (a.kind !== 'metro') return
    for (const j of around(a.lat, a.lon)) {
      const b = platforms[j]
      const { m } = nearestAccess(a, [b.lat, b.lon])
      if (m > BUS_METRO_TRANSFER_M) continue
      xfer[i].push({ to: j, m, s: 0 })
      xfer[j].push({ to: i, m, s: 0 })
    }
  })
  // 捷運站內換線
  for (const t of metro?.transfers ?? []) {
    const a = metroIdx.get(t.from)
    const b = metroIdx.get(t.to)
    if (a !== undefined && b !== undefined) xfer[a].push({ to: b, m: 0, s: t.walkS })
  }

  return { platforms, pats, onboard: offset, occ, xfer }
}

const graphs = new WeakMap<object, WeakMap<object, Graph>>()
const NO_METRO = {}
function graphFor(bus: BusNetwork, metro: MetroIndex | null): Graph {
  let inner = graphs.get(bus.stations)
  if (!inner) graphs.set(bus.stations, (inner = new WeakMap()))
  const key = metro ?? NO_METRO
  let g = inner.get(key)
  if (!g) inner.set(key, (g = buildGraph(bus, metro)))
  return g
}

// ---------------------------------------------------------------- 最短路

const SRC = 1
const BOARD = 2
const RIDE = 3
const ALIGHT = 4
const XFER = 5

class Heap {
  private c: number[] = []
  private s: number[] = []
  get size() {
    return this.c.length
  }
  push(cost: number, state: number) {
    const c = this.c
    const s = this.s
    let i = c.length
    c.push(cost)
    s.push(state)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (c[p] <= cost) break
      c[i] = c[p]
      s[i] = s[p]
      i = p
    }
    c[i] = cost
    s[i] = state
  }
  pop(): [number, number] {
    const c = this.c
    const s = this.s
    const top: [number, number] = [c[0], s[0]]
    const lc = c.pop()!
    const ls = s.pop()!
    if (c.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        let mc = lc
        if (l < c.length && c[l] < mc) {
          m = l
          mc = c[l]
        }
        if (r < c.length && c[r] < mc) m = r
        if (m === i) break
        c[i] = c[m]
        s[i] = s[m]
        i = m
      }
      c[i] = lc
      s[i] = ls
    }
    return top
  }
}

interface Search {
  dist: Float64Array
  prev: Int32Array
  /** 每個狀態是從哪一種邊來的（SRC、BOARD、RIDE、ALIGHT、XFER） */
  kind: Uint8Array
}

function search(g: Graph, from: LatLon, mps: number, allow: (mode: 'bus' | 'metro') => boolean, maxWalkM: number): Search {
  const K = MAX_RIDES + 1
  const P = g.platforms.length
  const n = (P + g.onboard) * K
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const kind = new Uint8Array(n)
  const heap = new Heap()
  const walk = (m: number) => (m * DETOUR) / mps

  g.platforms.forEach((pl, i) => {
    if (!allow(pl.kind)) return
    const { m } = nearestAccess(pl, from)
    if (m > maxWalkM) return
    const st = i * K
    dist[st] = walk(m)
    kind[st] = SRC
    heap.push(dist[st], st)
  })

  // 車上節點 → 哪條路線、第幾站
  const owner = new Int32Array(g.onboard)
  g.pats.forEach((p, pi) => {
    for (let i = 0; i < p.nodes.length; i++) owner[p.offset + i] = pi
  })

  const relax = (to: number, cost: number, from: number, k: number) => {
    if (cost < dist[to]) {
      dist[to] = cost
      prev[to] = from
      kind[to] = k
      heap.push(cost, to)
    }
  }

  while (heap.size) {
    const [d, st] = heap.pop()
    if (d > dist[st]) continue
    const node = Math.floor(st / K)
    const k = st % K
    if (node < P) {
      // 月台：上車，或（剛下車時）走去轉乘
      if (k < MAX_RIDES) {
        for (const [pi, i] of g.occ[node]) {
          const p = g.pats[pi]
          if (!allow(p.mode) || p.noBoard.has(i) || i >= p.nodes.length - 1) continue
          relax((P + p.offset + i) * K + k + 1, d + p.waitS + BOARD_PENALTY_S, st, BOARD)
        }
      }
      if (kind[st] === ALIGHT) {
        for (const x of g.xfer[node]) {
          if (!allow(g.platforms[x.to].kind)) continue
          relax(x.to * K + k, d + walk(x.m) + x.s, st, XFER)
        }
      }
    } else {
      const local = node - P
      const p = g.pats[owner[local]]
      const i = local - p.offset
      if (i < p.nodes.length - 1) relax((node + 1) * K + k, d + p.hopS[i], st, RIDE)
      if (kind[st] !== BOARD && !p.noAlight.has(i)) relax(p.nodes[i] * K + k, d, st, ALIGHT)
    }
  }
  return { dist, prev, kind }
}

// ---------------------------------------------------------------- 結果

function metroStationAsStation(ms: MetroStation, route: StationRoute): Station {
  return { stationUid: metroUid(ms.stationId), name: ms.name.zh ? { zh: ms.name.zh, en: ms.name.en } : { zh: ms.stationId, en: ms.name.en },
    bearing: null, lat: ms.lat, lon: ms.lon, routes: [{ ...route, stopUid: metroUid(ms.stationId) }] }
}

function busRoute(board: Station, p: RoutePattern): StationRoute {
  return board.routes.find((r) => r.routeName.zh === p.routeName.zh && r.direction === p.direction)
    ?? { routeName: p.routeName, direction: p.direction, headsign: p.headsign, stopUid: board.stationUid }
}

interface Segment {
  pat: Pat
  from: number
  to: number
  /** 出發後幾秒走到上車站（還沒等車） */
  reachS: number
  waitS: number
}

function toRide(g: Graph, seg: Segment, clock: Clock): Ride {
  const { pat } = seg
  if (pat.mode === 'bus') {
    const stations = pat.nodes.slice(seg.from, seg.to + 1).map((n) => g.platforms[n].bus!)
    const ride: Ride = { mode: 'bus', board: stations[0], route: busRoute(stations[0], pat.bus!), alight: stations[stations.length - 1], stops: stations }
    // 快照只有起點站的首末班，往後每站加上行車時間估算
    const span = pat.bus!.service?.[clock.weekend ? 'weekend' : 'weekday']
    if (span) {
      ride.firstS = span[0] + seg.from * BUS_STOP_S
      ride.lastS = span[1] + seg.from * BUS_STOP_S
    }
    return ride
  }
  const line = pat.line!
  const route: StationRoute = { routeName: { zh: line.name.zh ?? line.lineId, en: line.name.en }, direction: 255,
    headsign: pat.metro!.headsign, stopUid: '' }
  const stops = pat.nodes.slice(seg.from, seg.to + 1).map((n) => metroStationAsStation(g.platforms[n].metro!, route))
  const stopTimesS = [0]
  for (let i = seg.from; i < seg.to; i++) stopTimesS.push(stopTimesS[stopTimesS.length - 1] + pat.hopS[i])
  const ride: Ride = { mode: 'metro', board: stops[0], route: stops[0].routes[0], alight: stops[stops.length - 1], stops,
    lineColor: line.color, stopTimesS }
  const first = pat.metro!.firstS?.[seg.from]
  const last = pat.metro!.lastS?.[seg.from]
  if (first != null) ride.firstS = first
  if (last != null) ride.lastS = last
  return ride
}

function serviceOf(rides: Ride[], segments: Segment[], clock: Clock): ServiceState {
  let state: ServiceState = 'ok'
  rides.forEach((r, i) => {
    const reach = clock.nowS + segments[i].reachS
    if (r.lastS !== undefined && reach > r.lastS) state = 'ended'
    else if (state === 'ok' && r.firstS !== undefined && reach + segments[i].waitS < r.firstS) state = 'not_started'
  })
  return state
}

function reconstruct(g: Graph, s: Search, end: number, from: LatLon, to: LatLon, mps: number, finalM: number, clock: Clock): TransitPlan | null {
  const K = MAX_RIDES + 1
  const P = g.platforms.length
  const chain: number[] = []
  for (let st = end; st >= 0; st = s.prev[st]) chain.push(st)
  chain.reverse()

  const segments: Segment[] = []
  let walkM = 0
  let walkS = 0
  let waitS = 0
  let rideS = 0
  for (let c = 0; c < chain.length; c++) {
    const st = chain[c]
    const node = Math.floor(st / K)
    const k = s.kind[st]
    const before = c > 0 ? s.dist[chain[c - 1]] : 0
    const step = s.dist[st] - before
    if (k === SRC) {
      walkS += step
      walkM += (step * mps) / DETOUR
    } else if (k === XFER) {
      walkS += step
      const pl = Math.floor(chain[c - 1] / K)
      const x = g.xfer[pl].find((e) => e.to === node)
      walkM += x?.m ?? 0
    } else if (k === BOARD) {
      waitS += step - BOARD_PENALTY_S
      const local = node - P
      const pat = g.pats.find((p) => local >= p.offset && local < p.offset + p.nodes.length)!
      // 走到上車站的時間：之前每次上車的排序懲罰不是真的時間，要扣掉
      const reachS = before - segments.length * BOARD_PENALTY_S
      segments.push({ pat, from: local - pat.offset, to: local - pat.offset, reachS, waitS: step - BOARD_PENALTY_S })
    } else if (k === RIDE) {
      rideS += step
      segments[segments.length - 1].to += 1
    }
  }
  if (segments.length === 0) return null

  const rides = segments.map((seg) => toRide(g, seg, clock))
  // 捷運進出站：選離上一個位置最近的進站口、離下一個目標最近的出站口
  let here: LatLon = from
  rides.forEach((r, i) => {
    const seg = segments[i]
    if (r.mode === 'metro') {
      const boardAt = nearestAccess(g.platforms[seg.pat.nodes[seg.from]], here)
      r.boardPoint = boardAt.point
      r.boardExit = boardAt.exit
    }
    const next = rides[i + 1]
    const nextPoint: LatLon = next ? [next.board.lat, next.board.lon] : to
    if (r.mode === 'metro') {
      const alightAt = nearestAccess(g.platforms[seg.pat.nodes[seg.to]], nextPoint)
      r.alightPoint = alightAt.point
      r.alightExit = alightAt.exit
    }
    here = r.alightPoint ?? [r.alight.lat, r.alight.lon]
  })

  const finalS = (finalM * DETOUR) / mps
  walkS += finalS
  walkM += finalM
  return { rides, durationS: Math.round(walkS + waitS + rideS), walkS: Math.round(walkS), waitS: Math.round(waitS),
    rideS: Math.round(rideS), walkM: Math.round(walkM * DETOUR), service: serviceOf(rides, segments, clock) }
}

/** 下車又馬上搭同一條路線（同一條捷運線的區間車也算）：坐著不動就好，不列 */
function reboardsSameLine(p: TransitPlan): boolean {
  return p.rides.some((r, i) => i > 0 && p.rides[i - 1].mode === r.mode && p.rides[i - 1].route.routeName.zh === r.route.routeName.zh)
}

function signature(p: TransitPlan): string {
  return p.rides.map((r) => `${r.mode}:${r.route.routeName.zh}:${r.route.headsign.zh ?? ''}`).join('>')
}

function plansFor(
  g: Graph, from: LatLon, to: LatLon, mps: number, clock: Clock, allow: (m: 'bus' | 'metro') => boolean, maxWalkM: number,
): TransitPlan[] {
  const K = MAX_RIDES + 1
  const s = search(g, from, mps, allow, maxWalkM)
  const ends: { st: number; cost: number; finalM: number }[] = []
  g.platforms.forEach((pl, i) => {
    if (!allow(pl.kind)) return
    const { m } = nearestAccess(pl, to)
    if (m > maxWalkM) return
    for (let k = 1; k <= MAX_RIDES; k++) {
      const st = i * K + k
      if (s.kind[st] !== ALIGHT || !Number.isFinite(s.dist[st])) continue
      ends.push({ st, cost: s.dist[st] + (m * DETOUR) / mps, finalM: m })
    }
  })
  ends.sort((a, b) => a.cost - b.cost)
  const out: TransitPlan[] = []
  const seen = new Set<string>()
  for (const e of ends) {
    const plan = reconstruct(g, s, e.st, from, to, mps, e.finalM, clock)
    if (!plan || reboardsSameLine(plan)) continue
    const sig = signature(plan)
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(plan)
    if (out.length >= PLANS_PER_TAB * 2) break
  }
  return out
}

function walkPlan(from: LatLon, to: LatLon, mps: number): TransitPlan {
  const walkM = distanceM(from, to) * DETOUR
  const walkS = Math.round(walkM / mps)
  return { rides: [], durationS: walkS, walkS, waitS: 0, rideS: 0, walkM: Math.round(walkM), service: 'ok' }
}

/** 搭得到的排前面，同樣搭得到（或都搭不到）再比時間 */
function byUsable(a: TransitPlan, b: TransitPlan): number {
  return Number(a.service !== 'ok') - Number(b.service !== 'ok') || a.durationS - b.durationS
}

function top(plans: TransitPlan[]): TransitPlan[] {
  const seen = new Set<string>()
  // 搭得到的排前面，同樣搭得到（或都搭不到）再比時間
  return [...plans]
    .sort(byUsable)
    .filter((p) => {
      const sig = signature(p)
      if (seen.has(sig)) return false
      seen.add(sig)
      return true
    })
    .slice(0, PLANS_PER_TAB)
}

export function planTransit(
  bus: BusNetwork,
  metro: MetroIndex | null,
  from: LatLon,
  to: LatLon,
  opts: { audience: Audience; now?: Date },
): Record<PlanTab, TransitPlan[]> {
  const mps = WALK_MPS[opts.audience]
  const clock = serviceClock(opts.now ?? new Date())
  const walk = walkPlan(from, to, mps)
  const g = graphFor(bus, metro)
  // 先找 800 公尺內的站；找不到再放寬，捷運站離比較遠時也有路可以選
  const find = (allow: (m: 'bus' | 'metro') => boolean) => {
    for (const r of [MAX_WALK_M, ...WIDER_WALK_M]) {
      const plans = plansFor(g, from, to, mps, clock, allow, r)
      if (plans.length) return plans
    }
    return []
  }
  const busPlans = find((m) => m === 'bus')
  const metroPlans = metro ? find((m) => m === 'metro') : []
  const mixedPlans = find(() => true)

  // 比走路慢的方案也列出來讓使用者選，只是排在後面；走路一定是其中一個選項
  const mixed = [walk, ...top([...mixedPlans, ...busPlans, ...metroPlans])].sort(byUsable)
  return { mixed, bus: top(busPlans), metro: top(metroPlans) }
}
