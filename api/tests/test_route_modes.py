"""路線模式（快速／安全／平緩）：產生、20% 時間上限、挑選、原因代碼。"""
import asyncio

import pytest

from app import metrics, route_modes
from app.engine import EdgeInfo, EngineRoute, Maneuver, RouteNotFound
from app.main import get_measure, get_routing_engine
from app.metrics import Metrics
from app.route_modes import Candidate, MAX_TIME_RATIO, diff_of, reasons_for
from contract_checks import check_routes

ORIGIN, DEST = (25.1175, 121.5310), (25.1100, 121.5250)
REQUEST = {"from": {"lat": ORIGIN[0], "lon": ORIGIN[1]}, "to": {"lat": DEST[0], "lon": DEST[1]}, "audience": "visitor"}


def make_route(tag: int, duration_s: float, uturn=False, lat_shift=0.0) -> EngineRoute:
    """每條路的形狀不同（中間點往東偏 tag × 0.002 度），去重時不會被當成同一條。"""
    mid = ((ORIGIN[0] + DEST[0]) / 2 + lat_shift, (ORIGIN[1] + DEST[1]) / 2 + tag * 0.002)
    geometry = [ORIGIN, mid, DEST]
    kinds = ["depart", *(["uturn"] if uturn else []), "arrive"]
    maneuvers = [Maneuver(k, min(i, 2), 0, None) for i, k in enumerate(kinds)]
    maneuvers[-1] = Maneuver("arrive", 2, 0, None)
    return EngineRoute(duration_s * 1.4, duration_s, geometry, maneuvers, shape=f"s{tag}")


def tag_of(route: EngineRoute) -> int:
    return round((route.geometry[1][1] - (ORIGIN[1] + DEST[1]) / 2) / 0.002)


class StubEngine:
    """預設權重回 base，模式權重回 alt，有 via 時回 via_routes 的下一條。"""
    def __init__(self, base, alt=(), via_routes=(), edges=None):
        self.base, self.alt, self.via_routes = list(base), list(alt), list(via_routes)
        self.edge_map = edges or {}
        self.calls = []

    async def route(self, origin, dest, costing, alternates=0, via=None):
        self.calls.append({"costing": costing, "alternates": alternates, "via": via})
        if via:
            return [self.via_routes.pop(0)] if self.via_routes else []
        if costing.step_penalty or costing.use_lit:
            return self.alt
        if not self.base:
            raise RouteNotFound()
        return self.base if alternates else self.base[:1]

    async def edges(self, route):
        return self.edge_map.get(tag_of(route))

    async def ping(self):
        return True


def measure_by_tag(table):
    def measure(route):
        return table.get(tag_of(route), Metrics(0, 0.0, 0.5, 0, 0, 0, 0.0, 0, 0, 0, 0.0))
    return measure


def run(coro):
    return asyncio.run(coro)


# ── 原因代碼與分數 ─────────────────────────────────────
def m(**kw):
    base = dict(steps=0, climb_m=0.0, lit_ratio=0.5, unsignalized_crossings=0, signal_crossings=0, unknown_crossings=0,
                max_grade_pct=0.0, cameras=0, police_nearby=0, stores=0, shop_ratio=0.0, quiet_ratio=0.0, main_road_ratio=0.0)
    return Metrics(**{**base, **kw})


def test_diff_signs_are_positive_when_better():
    fast = Candidate(make_route(0, 600), m(steps=2, climb_m=10, cameras=1, quiet_ratio=0.4))
    cand = Candidate(make_route(1, 660), m(steps=0, climb_m=4, cameras=5, quiet_ratio=0.1))
    d = diff_of(cand, fast)
    assert d["durationS"] == 60 and d["steps"] == 2 and d["climbM"] == 6.0
    assert d["cameras"] == 4 and d["quietRatio"] == 0.3


def test_reasons_need_a_real_improvement():
    assert reasons_for("gentle", {"durationS": 0, "steps": 0, "climbM": 1.0, "maxGradePct": 1.0}) == []
    assert reasons_for("gentle", {"durationS": 45, "steps": 1, "climbM": 2.0, "maxGradePct": 2.0}) == \
        ["fewer_steps", "flatter", "gentler_slope", "extra_time"]
    safe = {"durationS": 10, "litRatio": 0.1, "cameras": 3, "policeNearby": 1, "stores": 1, "shopRatio": 0.1,
            "quietRatio": 0.1, "mainRoadRatio": 0.15}
    assert reasons_for("safe", safe) == ["brighter", "more_cameras", "near_police", "more_stores", "more_shops",
                                         "fewer_alleys", "main_roads"]
    assert reasons_for("safe", {k: (None if k != "durationS" else 0) for k in safe}) == []


def test_safety_score_prefers_watched_streets_and_penalises_alleys():
    fast = make_route(0, 600)
    busy = Candidate(make_route(1, 600), m(cameras=8, police_nearby=1, stores=3, shop_ratio=0.8, main_road_ratio=0.9))
    alley = Candidate(make_route(2, 600), m(quiet_ratio=0.8))
    assert route_modes.safety_score(busy, fast, night=True) > route_modes.safety_score(alley, fast, night=True)
    dark = Candidate(make_route(3, 600), m(lit_ratio=0.0))
    lit = Candidate(make_route(4, 600), m(lit_ratio=1.0))
    gap_night = route_modes.safety_score(lit, fast, True) - route_modes.safety_score(dark, fast, True)
    gap_day = route_modes.safety_score(lit, fast, False) - route_modes.safety_score(dark, fast, False)
    assert gap_night > gap_day > 0


def test_gentle_cost_counts_steps_climb_and_steepness():
    fast = make_route(0, 600)
    stairs = Candidate(make_route(1, 600), m(steps=2))
    hill = Candidate(make_route(2, 600), m(climb_m=12, max_grade_pct=10))
    flat = Candidate(make_route(3, 660), m(climb_m=1))
    costs = [route_modes.gentle_cost(c, fast) for c in (stairs, hill, flat)]
    assert costs[2] < costs[1] < costs[0]


# ── 挑選流程 ─────────────────────────────────────────
def test_safe_picks_best_within_time_cap():
    over = 600 * MAX_TIME_RATIO + 5
    engine = StubEngine(base=[make_route(0, 600), make_route(1, 690), make_route(2, over)])
    table = {0: m(cameras=1), 1: m(cameras=8, stores=2, shop_ratio=0.6), 2: m(cameras=30, police_nearby=2, stores=9)}
    result = run(route_modes.plan(engine, ORIGIN, DEST, "safe", "visitor", True, measure_by_tag(table)))
    assert tag_of(result.chosen.route) == 1  # 2 分數更高但超過 20%
    assert "more_cameras" in result.reasons and "more_stores" in result.reasons and "extra_time" in result.reasons
    assert result.diff["durationS"] == 90


def test_safe_uses_edges_to_avoid_alleys():
    edges = {
        0: [EdgeInfo(0, 1, "alley", "service_other", 300), EdgeInfo(1, 2, "road", "residential", 100)],
        1: [EdgeInfo(0, 1, "sidewalk", "secondary", 300), EdgeInfo(1, 2, "road", "primary", 120)],
    }
    engine = StubEngine(base=[make_route(0, 600), make_route(1, 640)], edges=edges)
    result = run(route_modes.plan(engine, ORIGIN, DEST, "safe", "visitor", False, measure_by_tag({})))
    assert tag_of(result.chosen.route) == 1
    assert result.chosen.metrics.quiet_ratio == 0.0 and result.fastest.metrics.quiet_ratio == 0.75
    assert {"fewer_alleys", "main_roads"} <= set(result.reasons)
    assert result.chosen.edges is edges[1]


def test_no_improvement_falls_back_to_fastest():
    engine = StubEngine(base=[make_route(0, 600), make_route(1, 650)])
    result = run(route_modes.plan(engine, ORIGIN, DEST, "gentle", "elder", False, measure_by_tag({})))
    assert result.chosen is result.fastest and result.reasons == ["fastest"]


def test_gentle_avoids_stairs_and_drops_uturns():
    engine = StubEngine(base=[make_route(0, 600)], alt=[make_route(1, 700), make_route(2, 610, uturn=True)])
    table = {0: m(steps=2, climb_m=8), 1: m(steps=0, climb_m=3), 2: m(steps=0, climb_m=0)}
    result = run(route_modes.plan(engine, ORIGIN, DEST, "gentle", "elder", False, measure_by_tag(table)))
    assert tag_of(result.chosen.route) == 1
    assert result.reasons[:2] == ["fewer_steps", "flatter"]
    # 平緩用的權重有重罰階梯，走路速度依對象
    mode_call = next(c for c in engine.calls if c["costing"].step_penalty)
    assert mode_call["costing"].walking_speed_kmh == 3.5 and mode_call["alternates"] == 2


def test_fast_is_one_call_without_alternates():
    engine = StubEngine(base=[make_route(0, 600), make_route(1, 610)])
    result = run(route_modes.plan(engine, ORIGIN, DEST, "fast", "child", False, measure_by_tag({})))
    assert result.chosen is result.fastest and len(engine.calls) == 1 and engine.calls[0]["alternates"] == 0


def test_mode_route_failure_is_not_fatal_but_fastest_failure_is():
    class Flaky(StubEngine):
        async def route(self, origin, dest, costing, alternates=0, via=None):
            if costing.use_lit:
                raise RuntimeError("boom")
            return await super().route(origin, dest, costing, alternates, via)
    result = run(route_modes.plan(Flaky(base=[make_route(0, 600)]), ORIGIN, DEST, "safe", "visitor", True, measure_by_tag({})))
    assert result.chosen is result.fastest
    with pytest.raises(RouteNotFound):
        run(route_modes.plan(StubEngine(base=[]), ORIGIN, DEST, "safe", "visitor", True, measure_by_tag({})))


# ── 經過點 ───────────────────────────────────────────
def test_safe_vias_prefer_police_and_skip_points_on_or_far_from_route(monkeypatch):
    fast = EngineRoute(1000, 700, [ORIGIN, (25.1137, 121.5280), DEST], [])
    on_route = (25.1137, 121.5280)
    near_store = (25.1137, 121.5288)     # 約 80 公尺外
    near_police = (25.1125, 121.5260)    # 約 75 公尺外
    far = (25.1137, 121.5400)            # 1 公里外
    monkeypatch.setattr(metrics, "anchor_points", lambda *box: [
        (*on_route, "store"), (*near_store, "store"), (*far, "store"), (*near_police, "police")])
    vias = route_modes.safe_vias(ORIGIN, DEST, fast)
    assert vias[0] == near_police and near_store in vias and on_route not in vias and far not in vias


def test_gentle_vias_only_when_fastest_has_a_hill():
    flat = Candidate(make_route(0, 600), m(steps=0, climb_m=1.0))
    assert route_modes.gentle_vias(ORIGIN, DEST, flat) == []
    hilly = Candidate(make_route(0, 600), m(steps=1, climb_m=None))
    vias = route_modes.gentle_vias(ORIGIN, DEST, hilly)  # 沒有高程網格：只看距離
    assert 1 <= len(vias) <= len(route_modes.GENTLE_VIA_OFFSETS)


# ── API ──────────────────────────────────────────────
def test_api_mode_response(client):
    engine = StubEngine(base=[make_route(0, 600), make_route(1, 690)])
    table = {0: m(cameras=0), 1: m(cameras=6, stores=2)}
    from app.main import app
    app.dependency_overrides[get_routing_engine] = lambda: engine
    app.dependency_overrides[get_measure] = lambda: measure_by_tag(table)
    body = client.post("/api/routes", json={**REQUEST, "mode": "safe", "simulate": "night"}).json()
    check_routes(body)
    assert body["context"]["mode"] == "safe" and body["context"]["maxTimeRatio"] == 1.2
    assert [r["id"] for r in body["routes"]] == ["safe", "fastest"]
    assert body["routes"][0]["diff"]["cameras"] == 6 and body["routes"][0]["metrics"]["stores"] == 2
    assert body["notes"] == ["simulated_night"]
    assert "s0" not in client.post("/api/routes", json={**REQUEST, "mode": "safe"}).text  # 不回引擎的 polyline


def test_api_mode_with_fake_engine(client):
    for mode in ("fast", "safe", "gentle"):
        body = client.post("/api/routes", json={**REQUEST, "mode": mode}).json()
        check_routes(body)
        assert body["routes"][0]["recommended"]
    assert client.post("/api/routes", json={**REQUEST, "mode": "scenic"}).status_code == 422


def test_api_mode_errors(client, fake_engine):
    fake_engine.mode = "no_route"
    assert client.post("/api/routes", json={**REQUEST, "mode": "safe"}).json()["error"]["code"] == "ROUTE_NOT_FOUND"
    fake_engine.mode = "down"
    assert client.post("/api/routes", json={**REQUEST, "mode": "gentle"}).json()["error"]["code"] == "ROUTING_UNAVAILABLE"


def test_unknown_edges_are_not_free():
    fast = make_route(0, 600)
    known_clean = Candidate(make_route(1, 600), m(quiet_ratio=0.0))
    unknown = Candidate(make_route(2, 600), m(quiet_ratio=None))
    assert route_modes.safety_score(known_clean, fast, True) > route_modes.safety_score(unknown, fast, True)


def test_safe_only_traces_the_top_candidates():
    routes = [make_route(i, 600 + i) for i in range(6)]
    engine = StubEngine(base=routes[:3], alt=routes[3:])
    traced = []
    original = engine.edges
    async def edges(route):
        traced.append(tag_of(route))
        return await original(route)
    engine.edges = edges
    table = {i: m(cameras=i) for i in range(6)}
    run(route_modes.plan(engine, ORIGIN, DEST, "safe", "visitor", True, measure_by_tag(table)))
    assert sorted(traced) == [0, 3, 4, 5]  # 最快路線＋分數前三名


def test_quick_skips_via_points(client):
    engine = StubEngine(base=[make_route(0, 600)])
    from app.main import app
    app.dependency_overrides[get_routing_engine] = lambda: engine
    app.dependency_overrides[get_measure] = lambda: measure_by_tag({0: m(steps=3, climb_m=20)})
    assert client.post("/api/routes", json={**REQUEST, "mode": "gentle", "quick": True}).status_code == 200
    assert all(c["via"] is None for c in engine.calls)
    engine.calls.clear()
    client.post("/api/routes", json={**REQUEST, "mode": "gentle"})
    assert any(c["via"] for c in engine.calls)  # 不是 quick 才找經過點
