"""路線模式：使用者在「路線模式」選單選的快速、安全、平緩。

做法和 02 一樣是「先產生、再量測、再挑選」，但目標由使用者決定，不看對象的規則表：

1. 產生：預設權重（含 2 條替代路線）＋模式的權重（含 2 條替代路線）；
   再加幾條「經過某一點」的繞行路線（Valhalla 不能直接偏好監視器、派出所或坡度，只能用經過點逼它走別條路）。
   - 安全：經過最快路線附近、但不在路線上的派出所或便利商店。
   - 平緩：起終點連線中點往左右偏的點，而且那裡的地形比最快路線的最高點低。
2. 量測：metrics.measure（階梯、爬升、坡度、路燈、監視器、派出所、便利商店、店面），
   安全模式再用 trace_attributes 算走在小巷、主要道路的長度比例。
3. 篩選：時間超過最快路線 MAX_TIME_RATIO 倍的不參加挑選（不刻意繞遠路）；相同的路合併；有迴轉的丟掉。
4. 挑選：依模式的分數挑一條；量得到改善才給原因代碼，否則推薦最快路線並加 no_better_route。

門檻與係數都是起始值，調整只改這個檔案頂部的常數。用詞規則見 docs/arrow-nav/02-route-candidates.md：
API 只回代碼和數字，句子由前端組，不宣稱「安全」「無障礙」。
"""
import asyncio
import logging
import math
from dataclasses import dataclass, replace
from typing import Literal

from app import elevation, metrics
from app.engine import EdgeInfo, EngineRoute, LatLon, PedestrianCosting, RouteNotFound
from app.geo import haversine_m
from app.route_rules import WALKING_SPEED_KMH, same_route

logger = logging.getLogger(__name__)

Mode = Literal["fast", "safe", "gentle"]

# ── 篩選 ─────────────────────────────────────────────
#: 其他模式的路線時間最多是最快路線的幾倍（使用者要求：不超過 20%）
MAX_TIME_RATIO = 1.20
ALTERNATES = 2

# ── 產生路線用的權重（疊在 PedestrianCosting 預設值上） ──
MODE_COSTING = {
    # 偏好有路燈、避開小巷與私人車道、少走公園步道（晚上人少），偏好人行道
    "safe": {"use_lit": 1.0, "alley_factor": 6.0, "driveway_factor": 8.0, "walkway_factor": 1.3, "sidewalk_factor": 0.8},
    # 階梯重罰；use_hills 0 只有路網有高程時才有效，所以另外靠經過點和 DTM 量測挑選；山區步道常有階梯和陡坡
    "gentle": {"step_penalty": 600, "elevator_penalty": 0, "use_hills": 0.0, "walkway_factor": 1.2},
}

# ── 經過點 ───────────────────────────────────────────
SAFE_VIA_MAX = 3
#: 已經在最快路線這麼近的點，不用特地繞過去
VIA_ON_ROUTE_M = 40
#: 離最快路線太遠的點不考慮（一定超過時間上限）
VIA_MAX_OFF_ROUTE_M = 350
VIA_MIN_SPACING_M = 150
#: 離起點或終點這麼近的點，繞過去沒有意義
VIA_END_CLEARANCE_M = 60
#: 直線距離換算步行距離的係數（估算繞路多遠，用來先剔除一定超時的點）
WALK_DETOUR_FACTOR = 1.25
#: 平緩：中點往左右偏的距離（起終點直線距離的倍數），最多偏 GENTLE_VIA_MAX_OFFSET_M
GENTLE_VIA_OFFSETS = (-0.35, -0.18, 0.18, 0.35)
GENTLE_VIA_MAX_OFFSET_M = 400
#: 平緩：經過點要比最快路線的最高點低這麼多，才有機會避開坡
GENTLE_VIA_LOWER_M = 3
#: 最快路線的爬升與階梯都在這以下，就不另外找平緩的繞行路線
GENTLE_FLAT_ENOUGH_CLIMB_M = 3

# ── 安全分數：每項大約 0–1，乘上權重相加；越高越好 ───────
W_LIT_NIGHT = 3.0
W_LIT_DAY = 1.0
W_CAMERAS = 2.0
CAMERAS_PER_100M_FULL = 2.0   # 每 100 公尺 2 支就算滿分
W_POLICE = 2.0
POLICE_FULL = 2
W_STORES = 2.0
STORES_PER_100M_FULL = 0.5    # 每 200 公尺一家便利商店就算滿分
W_SHOPS = 2.0
W_QUIET = -4.0                # 小巷、私人車道、產業道路、山徑
#: 問不到路段種類時，當成有這麼多比例是小巷（不知道不等於沒有）
UNKNOWN_QUIET_RATIO = 0.25
W_MAIN_ROAD = 1.0
#: 先用不含路段種類的分數排序，只替前幾名問 trace_attributes（每問一次都要時間）
SAFE_EDGE_TOP = 3
#: 每多走 1 分鐘扣的分數（分數差不多時選比較快的）
SAFE_TIME_PENALTY_PER_MIN = 0.1

# ── 平緩成本：越低越好 ─────────────────────────────────
STEP_COST = 20.0              # 每段階梯
CLIMB_COST_PER_M = 1.0
STEEP_FROM_PCT = 5.0
STEEP_COST_PER_PCT = 0.8
GENTLE_TIME_COST_PER_MIN = 0.5

# ── 原因代碼門檻 ────────────────────────────────────────
FLATTER_MIN_M = 2
GENTLER_SLOPE_MIN_PCT = 2
BRIGHTER_MIN_DELTA = 0.1
MORE_CAMERAS_MIN = 3
MORE_STORES_MIN = 1
MORE_SHOPS_MIN_DELTA = 0.1
FEWER_ALLEYS_MIN_DELTA = 0.1
MAIN_ROADS_MIN_DELTA = 0.15
EXTRA_TIME_MIN_S = 30


@dataclass(frozen=True)
class Candidate:
    route: EngineRoute
    metrics: metrics.Metrics
    edges: list[EdgeInfo] | None = None


@dataclass(frozen=True)
class ModeResult:
    """chosen 是要推薦的路；和最快路線相同時 chosen is fastest。"""
    fastest: Candidate
    chosen: Candidate
    reasons: list[str]
    diff: dict | None


def costing_for_mode(mode: str, audience: str, base: str = "default") -> PedestrianCosting:
    """base="default" 是標準步行；base="mode" 疊上模式的權重。走路速度依對象。"""
    costing = PedestrianCosting(walking_speed_kmh=WALKING_SPEED_KMH[audience])
    if base == "mode" and mode in MODE_COSTING:
        costing = replace(costing, **MODE_COSTING[mode])
    return costing


def within_time(route: EngineRoute, fastest: EngineRoute) -> bool:
    return route.duration_s <= fastest.duration_s * MAX_TIME_RATIO + 1e-6


def _per_100m(count: int, distance_m: float) -> float:
    return count / max(distance_m, 100) * 100


def safety_score(c: Candidate, fastest: EngineRoute, night: bool, with_edges: bool = True) -> float:
    """with_edges=False：還沒問路段種類時的初步分數（只用來決定要替誰問）。"""
    m, r = c.metrics, c.route
    score = 0.0
    if m.lit_ratio is not None:
        score += (W_LIT_NIGHT if night else W_LIT_DAY) * m.lit_ratio
    if m.cameras is not None:
        score += W_CAMERAS * min(_per_100m(m.cameras, r.distance_m) / CAMERAS_PER_100M_FULL, 1)
    if m.police_nearby is not None:
        score += W_POLICE * min(m.police_nearby, POLICE_FULL) / POLICE_FULL
    if m.stores is not None:
        score += W_STORES * min(_per_100m(m.stores, r.distance_m) / STORES_PER_100M_FULL, 1)
    if m.shop_ratio is not None:
        score += W_SHOPS * m.shop_ratio
    if with_edges:
        score += W_QUIET * (m.quiet_ratio if m.quiet_ratio is not None else UNKNOWN_QUIET_RATIO)
        if m.main_road_ratio is not None:
            score += W_MAIN_ROAD * m.main_road_ratio
    extra_min = max(0.0, r.duration_s - fastest.duration_s) / 60
    return score - SAFE_TIME_PENALTY_PER_MIN * extra_min


def gentle_cost(c: Candidate, fastest: EngineRoute) -> float:
    m, r = c.metrics, c.route
    cost = STEP_COST * (m.steps or 0)
    if m.climb_m is not None:
        cost += CLIMB_COST_PER_M * m.climb_m
    if m.max_grade_pct is not None:
        cost += STEEP_COST_PER_PCT * max(0.0, m.max_grade_pct - STEEP_FROM_PCT)
    extra_min = max(0.0, r.duration_s - fastest.duration_s) / 60
    return cost + GENTLE_TIME_COST_PER_MIN * extra_min


def _gain(cand, fast, digits=None):
    """改善量：越大越好的欄位用 cand − fast。None 表示其中一邊沒有資料。"""
    if cand is None or fast is None:
        return None
    return round(cand - fast, digits) if digits is not None else cand - fast


def _drop(cand, fast, digits=None):
    """減少量：越小越好的欄位用 fast − cand。"""
    if cand is None or fast is None:
        return None
    return round(fast - cand, digits) if digits is not None else fast - cand


def diff_of(cand: Candidate, fast: Candidate) -> dict:
    """和最快路線比。distanceM、durationS 是多走多少；其他欄位一律「正數＝比較好」。"""
    a, b = cand.metrics, fast.metrics
    return {
        "distanceM": round(cand.route.distance_m - fast.route.distance_m),
        "durationS": round(cand.route.duration_s - fast.route.duration_s),
        "steps": _drop(a.steps, b.steps),
        "climbM": _drop(a.climb_m, b.climb_m, 1),
        "maxGradePct": _drop(a.max_grade_pct, b.max_grade_pct, 1),
        "unsignalizedCrossings": _drop(a.unsignalized_crossings, b.unsignalized_crossings),
        "litRatio": _gain(a.lit_ratio, b.lit_ratio, 2),
        "cameras": _gain(a.cameras, b.cameras),
        "policeNearby": _gain(a.police_nearby, b.police_nearby),
        "stores": _gain(a.stores, b.stores),
        "shopRatio": _gain(a.shop_ratio, b.shop_ratio, 2),
        "quietRatio": _drop(a.quiet_ratio, b.quiet_ratio, 2),
        "mainRoadRatio": _gain(a.main_road_ratio, b.main_road_ratio, 2),
    }


def reasons_for(mode: str, diff: dict) -> list[str]:
    """量得到改善才給；一個都沒有就不推薦這條。extra_time 只在有其他原因時附上。"""
    def at_least(key, threshold):
        value = diff.get(key)
        return value is not None and value >= threshold - 1e-9
    reasons = []
    if mode == "gentle":
        if at_least("steps", 1):
            reasons.append("fewer_steps")
        if at_least("climbM", FLATTER_MIN_M):
            reasons.append("flatter")
        if at_least("maxGradePct", GENTLER_SLOPE_MIN_PCT):
            reasons.append("gentler_slope")
    elif mode == "safe":
        if at_least("litRatio", BRIGHTER_MIN_DELTA):
            reasons.append("brighter")
        if at_least("cameras", MORE_CAMERAS_MIN):
            reasons.append("more_cameras")
        if at_least("policeNearby", 1):
            reasons.append("near_police")
        if at_least("stores", MORE_STORES_MIN):
            reasons.append("more_stores")
        if at_least("shopRatio", MORE_SHOPS_MIN_DELTA):
            reasons.append("more_shops")
        if at_least("quietRatio", FEWER_ALLEYS_MIN_DELTA):
            reasons.append("fewer_alleys")
        if at_least("mainRoadRatio", MAIN_ROADS_MIN_DELTA):
            reasons.append("main_roads")
    if reasons and diff["durationS"] >= EXTRA_TIME_MIN_S:
        reasons.append("extra_time")
    return reasons


# ── 經過點 ───────────────────────────────────────────
def _distance_to_route_m(point: LatLon, geometry: list[LatLon]) -> float:
    if len(geometry) < 2:
        return haversine_m(point, geometry[0]) if geometry else math.inf
    return min(metrics._distance_to_segment_m(point, a, b) for a, b in zip(geometry, geometry[1:]))


def _estimated_extra_m(origin: LatLon, dest: LatLon, point: LatLon) -> float:
    return (haversine_m(origin, point) + haversine_m(point, dest) - haversine_m(origin, dest)) * WALK_DETOUR_FACTOR


def _spread(points: list[LatLon], limit: int) -> list[LatLon]:
    """依序取點，彼此至少隔 VIA_MIN_SPACING_M，最多 limit 個。"""
    picked: list[LatLon] = []
    for p in points:
        if all(haversine_m(p, q) >= VIA_MIN_SPACING_M for q in picked):
            picked.append(p)
        if len(picked) >= limit:
            break
    return picked


def safe_vias(origin: LatLon, dest: LatLon, fastest: EngineRoute) -> list[LatLon]:
    """最快路線附近（不在路線上）的派出所與便利商店，派出所優先、繞得少的優先。"""
    budget = fastest.distance_m * (MAX_TIME_RATIO - 1)
    lats = [p[0] for p in fastest.geometry] + [origin[0], dest[0]]
    lons = [p[1] for p in fastest.geometry] + [origin[1], dest[1]]
    pad_lat = VIA_MAX_OFF_ROUTE_M / 111_195
    pad_lon = pad_lat / math.cos(math.radians(origin[0]))
    found = metrics.anchor_points(min(lats) - pad_lat, max(lats) + pad_lat, min(lons) - pad_lon, max(lons) + pad_lon)
    ranked = []
    for lat, lon, kind in found:
        p = (lat, lon)
        if min(haversine_m(p, origin), haversine_m(p, dest)) < VIA_END_CLEARANCE_M:
            continue
        extra = _estimated_extra_m(origin, dest, p)
        if extra > budget:
            continue
        off = _distance_to_route_m(p, fastest.geometry)
        if not VIA_ON_ROUTE_M < off <= VIA_MAX_OFF_ROUTE_M:
            continue
        ranked.append((kind != "police", extra, p))
    ranked.sort()
    return _spread([p for *_, p in ranked], SAFE_VIA_MAX)


def gentle_vias(origin: LatLon, dest: LatLon, fastest: Candidate) -> list[LatLon]:
    """起終點連線中點往左右偏的點；有高程時只留比最快路線最高點低的。"""
    m = fastest.metrics
    if (m.steps or 0) == 0 and (m.climb_m is None or m.climb_m <= GENTLE_FLAT_ENOUGH_CLIMB_M):
        return []
    straight = haversine_m(origin, dest)
    if straight < 100:
        return []
    mid = ((origin[0] + dest[0]) / 2, (origin[1] + dest[1]) / 2)
    # 以公尺計的垂直方向
    scale = math.cos(math.radians(mid[0]))
    dx, dy = (dest[1] - origin[1]) * scale, dest[0] - origin[0]
    norm = math.hypot(dx, dy)
    px, py = -dy / norm, dx / norm
    heights = [h for h in (elevation.height(*p) for p in metrics._samples(fastest.route.geometry)) if h is not None]
    top = max(heights) if heights else None
    budget = fastest.route.distance_m * (MAX_TIME_RATIO - 1)
    out = []
    for k in GENTLE_VIA_OFFSETS:
        offset_m = math.copysign(min(abs(k) * straight, GENTLE_VIA_MAX_OFFSET_M), k)
        deg = offset_m / 111_195
        p = (mid[0] + py * deg, mid[1] + px * deg / scale)
        if _estimated_extra_m(origin, dest, p) > budget:
            continue
        if top is not None:
            h = elevation.height(*p)
            if h is None or h > top - GENTLE_VIA_LOWER_M:
                continue
        out.append(p)
    return out


# ── 主流程 ───────────────────────────────────────────
async def plan(engine, origin: LatLon, dest: LatLon, mode: str, audience: str, night: bool, measure,
               quick: bool = False) -> ModeResult:
    """回傳最快路線與推薦路線。最快路線算不出來時丟出引擎的例外（呼叫端轉成 404／503）。

    quick：走到一半重新規劃，不另外找經過點的繞行路線（少幾次引擎呼叫）。"""
    def measured(route: EngineRoute) -> metrics.Metrics:
        try:
            return measure(route)
        except Exception as exc:
            logger.error("路線量測錯誤類型: %s", type(exc).__name__)
            return metrics.Metrics(None, None, None, None, None, None)

    async def safe_call(coro):
        try:
            return await coro
        except Exception as exc:
            logger.warning("候選路線失敗類型: %s", type(exc).__name__)
            return []

    async def with_edges(c: Candidate) -> Candidate:
        try:
            edges = await engine.edges(c.route)
        except Exception as exc:
            logger.warning("路段屬性失敗類型: %s", type(exc).__name__)
            edges = None
        quiet, main = metrics.edge_ratios(edges)
        return replace(c, edges=edges, metrics=replace(c.metrics, quiet_ratio=quiet, main_road_ratio=main))

    default = costing_for_mode(mode, audience)
    if mode == "fast":
        routes = await engine.route(origin, dest, default)
        if not routes:
            raise RouteNotFound()
        fastest = await with_edges(Candidate(routes[0], measured(routes[0])))
        return ModeResult(fastest, fastest, ["fastest"], None)

    base, alt = await asyncio.gather(
        engine.route(origin, dest, default, alternates=ALTERNATES),
        safe_call(engine.route(origin, dest, costing_for_mode(mode, audience, "mode"), alternates=ALTERNATES)),
        return_exceptions=True,
    )
    if isinstance(base, Exception):
        raise base
    if not base:
        raise RouteNotFound()
    fastest = Candidate(base[0], measured(base[0]))
    if quick:
        vias = []
    else:
        vias = safe_vias(origin, dest, fastest.route) if mode == "safe" else gentle_vias(origin, dest, fastest)
    via_routes = await asyncio.gather(*(safe_call(engine.route(origin, dest, default, via=[p])) for p in vias))

    pool: list[EngineRoute] = []
    for route in [*base[1:], *alt, *(r for found in via_routes for r in found)]:
        if not within_time(route, fastest.route):
            continue
        if any(m.kind == "uturn" for m in route.maneuvers):
            continue
        if same_route(route, fastest.route) or any(same_route(route, kept) for kept in pool):
            continue
        pool.append(route)
    candidates = [Candidate(r, measured(r)) for r in pool]

    if mode == "safe":
        candidates.sort(key=lambda c: safety_score(c, fastest.route, night, with_edges=False), reverse=True)
        candidates = candidates[:SAFE_EDGE_TOP]
        fastest, *candidates = await asyncio.gather(with_edges(fastest), *(with_edges(c) for c in candidates))
        def better(c):
            return safety_score(c, fastest.route, night)
        best = max(candidates, key=better, default=None)
        improved = best is not None and better(best) > better(fastest)
    else:
        def cost(c):
            return gentle_cost(c, fastest.route)
        best = min(candidates, key=cost, default=None)
        improved = best is not None and cost(best) < cost(fastest)

    if improved:
        diff = diff_of(best, fastest)
        reasons = reasons_for(mode, diff)
        if reasons:
            if mode != "safe":
                best, fastest = await asyncio.gather(with_edges(best), with_edges(fastest))
            return ModeResult(fastest, best, reasons, diff_of(best, fastest))
    if mode != "safe":
        fastest = await with_edges(fastest)
    return ModeResult(fastest, fastest, ["fastest"], None)
