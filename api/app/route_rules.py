"""規則表與候選路線判斷（02）。門檻都是起始值，隊友調整只改這個檔案頂部的常數。"""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from math import cos, radians, hypot
from typing import Literal

from app.engine import EngineRoute, PedestrianCosting
from app.metrics_stub import Metrics

TPE = timezone(timedelta(hours=8))
NIGHT_START_HOUR = 18
NIGHT_END_HOUR = 6
CANDIDATE_IDS = ("fastest", "fewer_steps_hills", "fewer_steps_hills_bright", "fewer_unsignalized", "fewer_unsignalized_bright", "bright")
WALKING_SPEED_KMH = {"elder": 3.5, "child": 5.1, "visitor": 5.1}


def period_of(now: datetime, simulate: str | None) -> Literal["day", "night"]:
    hour = now.astimezone(TPE).hour
    return "night" if simulate == "night" or hour >= NIGHT_START_HOUR or hour < NIGHT_END_HOUR else "day"



RULES = {
    ("elder", "day"): ["fewer_steps_hills", "fastest"],
    ("elder", "night"): ["fewer_steps_hills_bright", "fastest"],
    ("child", "day"): ["fewer_unsignalized", "fastest"],
    ("child", "night"): ["fewer_unsignalized_bright", "fastest"],
    ("visitor", "day"): ["fastest"],
    ("visitor", "night"): ["bright", "fastest"],
}
WEIGHTS = {
    "steps": {"step_penalty": 120, "elevator_penalty": 0},
    "hills": {"use_hills": 0.1},
    "bright": {"use_lit": 0.8, "alley_factor": 3},
    "unsignalized": {"sidewalk_factor": 0.8, "walkway_factor": 0.9, "alley_factor": 3, "driveway_factor": 8},
}
PARTS = {
    "fastest": (), "fewer_steps_hills": ("steps", "hills"),
    "fewer_steps_hills_bright": ("steps", "hills", "bright"),
    "fewer_unsignalized": ("unsignalized",),
    "fewer_unsignalized_bright": ("unsignalized", "bright"), "bright": ("bright",),
}
CHILD_ALTERNATES = 2
SAME_DISTANCE_RATIO = 0.05
SAME_POINT_SHARE = 0.80
SAME_POINT_TOLERANCE_M = 15
DETOUR_MAX_EXTRA_M = 300
DETOUR_MAX_RATIO = 1.5
BRIGHTER_MIN_DELTA = 0.1
FLATTER_MIN_M = 2
EXTRA_DISTANCE_MIN_M = 20


def candidates_for(audience, period):
    return RULES[audience, period].copy()


def costing_for(candidate_id, audience):
    costing = PedestrianCosting()
    for part in PARTS[candidate_id]:
        costing = replace(costing, **WEIGHTS[part])
    return replace(costing, walking_speed_kmh=WALKING_SPEED_KMH[audience])


def alternates_for(candidate_id):
    return CHILD_ALTERNATES if "unsignalized" in PARTS[candidate_id] else 0


def same_route(a: EngineRoute, b: EngineRoute) -> bool:
    if abs(a.distance_m - b.distance_m) / max(a.distance_m, b.distance_m, 1) >= SAME_DISTANCE_RATIO:
        return False
    if not a.geometry or not b.geometry:
        return False
    latitude = sum(p[0] for p in a.geometry + b.geometry) / (len(a.geometry) + len(b.geometry))
    scale_x = 6371000 * cos(radians(latitude))
    scale_y = 6371000
    def project(points):
        return [(radians(lon) * scale_x, radians(lat) * scale_y) for lat, lon in points]
    def share(points, line):
        segments = list(zip(line, line[1:])) or [(line[0], line[0])]
        def near(p):
            for start, end in segments:
                dx, dy = end[0] - start[0], end[1] - start[1]
                length2 = dx * dx + dy * dy
                t = max(0, min(1, ((p[0]-start[0])*dx + (p[1]-start[1])*dy) / length2)) if length2 else 0
                if hypot(p[0]-start[0]-t*dx, p[1]-start[1]-t*dy) <= SAME_POINT_TOLERANCE_M:
                    return True
            return False
        return sum(near(p) for p in points) / len(points) >= SAME_POINT_SHARE
    x, y = project(a.geometry), project(b.geometry)
    return share(x, y) and share(y, x)


def detour_too_long(cand, fastest):
    extra = cand.distance_m - fastest.distance_m > DETOUR_MAX_EXTRA_M
    return extra or (fastest.distance_m != 0 and cand.distance_m > DETOUR_MAX_RATIO * fastest.distance_m)


def pick_child(routes: list[EngineRoute], metrics: list[Metrics]) -> int:
    if all(m.unsignalized_crossings is None for m in metrics):
        return 0
    return min(range(len(routes)), key=lambda i: (metrics[i].unsignalized_crossings is None,
        metrics[i].unsignalized_crossings if metrics[i].unsignalized_crossings is not None else 0,
        routes[i].distance_m, i))


def diff_of(cand_route, cand_m, fast_route, fast_m):
    def difference(fast, cand, digits=None):
        if fast is None or cand is None:
            return None
        return round(fast - cand, digits) if digits is not None else fast - cand
    return {"distanceM": round(cand_route.distance_m-fast_route.distance_m),
            "durationS": round(cand_route.duration_s-fast_route.duration_s),
            "steps": difference(fast_m.steps, cand_m.steps),
            "climbM": difference(fast_m.climb_m, cand_m.climb_m, 1),
            "unsignalizedCrossings": difference(fast_m.unsignalized_crossings, cand_m.unsignalized_crossings)}


def reasons_for(candidate_id, cand_m, fast_m, diff):
    parts = PARTS[candidate_id]
    reasons = []
    if "steps" in parts and cand_m.steps is not None and fast_m.steps is not None and cand_m.steps < fast_m.steps:
        reasons.append("fewer_steps")
    if "hills" in parts and cand_m.climb_m is not None and fast_m.climb_m is not None and fast_m.climb_m - cand_m.climb_m >= FLATTER_MIN_M:
        reasons.append("flatter")
    if "bright" in parts and cand_m.lit_ratio is not None and fast_m.lit_ratio is not None and cand_m.lit_ratio - fast_m.lit_ratio >= BRIGHTER_MIN_DELTA - 1e-12:
        reasons.append("brighter")
    if "unsignalized" in parts and cand_m.unsignalized_crossings is not None and fast_m.unsignalized_crossings is not None and cand_m.unsignalized_crossings < fast_m.unsignalized_crossings:
        reasons.append("fewer_unsignalized_crossings")
    if reasons and diff["distanceM"] >= EXTRA_DISTANCE_MIN_M:
        reasons.append("extra_distance")
    return reasons
