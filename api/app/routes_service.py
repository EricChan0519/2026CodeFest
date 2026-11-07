"""路線計算：規則表選候選、比對、去重、繞路上限、原因代碼，並轉成 03 合約格式。"""
import asyncio
import logging
import os
from datetime import datetime

from app.engine import RouteNotFound, RoutingEngine, RoutingUnavailable
from app.errors import ApiError
from app.geo import in_area
from app.route_rules import (alternates_for, candidates_for, costing_for, detour_too_long,
                             diff_of, period_of, pick_child, reasons_for, same_route)
try:  # B 交付 app/metrics.py 後自動改用；Metrics 與 measure 要來自同一個模組
    from app.metrics import Metrics, measure as default_measure
except ImportError:
    from app.metrics_stub import Metrics, measure as default_measure
from app.schemas import RoutesRequest

logger = logging.getLogger(__name__)


def route_to_dict(route, id, recommended, reasons, metrics, diff):
    return {"id": id, "recommended": recommended, "reasons": reasons,
            "distanceM": round(route.distance_m), "durationS": round(route.duration_s),
            "geometry": [[round(lat, 6), round(lon, 6)] for lat, lon in route.geometry],
            "maneuvers": [{"kind": m.kind, "atIndex": m.at_index,
                           "distanceToNextM": round(m.distance_to_next_m), "street": m.street}
                          for m in route.maneuvers],
            "metrics": metrics, "diff": diff}


def metrics_to_dict(m):
    return {"steps": m.steps, "climbM": round(m.climb_m, 1) if m.climb_m is not None else None,
            "litRatio": round(m.lit_ratio, 2) if m.lit_ratio is not None else None,
            "unsignalizedCrossings": m.unsignalized_crossings,
            "signalCrossings": m.signal_crossings, "unknownCrossings": m.unknown_crossings}


async def plan_routes(req: RoutesRequest, engine: RoutingEngine, now: datetime, measure=None) -> dict:
    origin, dest = (req.from_.lat, req.from_.lon), (req.to.lat, req.to.lon)
    if not in_area(*origin) or not in_area(*dest):
        raise ApiError("OUT_OF_AREA", 400)
    measure = default_measure if measure is None else measure
    simulated = req.simulate == "night"
    period = period_of(now, req.simulate)
    notes = []

    async def calculate(candidate):
        return await engine.route(origin, dest, costing_for(candidate, req.audience),
                                  alternates=alternates_for(candidate))

    def checked(result):
        if isinstance(result, Exception):
            logger.error("路線引擎錯誤類型: %s", type(result).__name__)
            if isinstance(result, RouteNotFound):
                raise ApiError("ROUTE_NOT_FOUND", 404) from None
            raise ApiError("ROUTING_UNAVAILABLE", 503) from None
        if not result:
            raise ApiError("ROUTE_NOT_FOUND", 404)
        return result

    def measured(route):
        try:
            return measure(route)
        except Exception as exc:
            logger.error("路線量測錯誤類型: %s", type(exc).__name__)
            return Metrics(None, None, None, None, None, None)

    def choose(candidate, routes):
        values = [measured(route) for route in routes]
        index = pick_child(routes, values) if alternates_for(candidate) else 0
        return routes[index], values[index]

    def serialize(route, candidate, recommended, reasons, metrics, diff=None):
        return route_to_dict(route, candidate, recommended, reasons, metrics_to_dict(metrics), diff)

    if req.candidate:
        result = (await asyncio.gather(calculate(req.candidate), return_exceptions=True))[0]
        route, metrics = choose(req.candidate, checked(result))
        output = [serialize(route, req.candidate, True, ["fastest"] if req.candidate == "fastest" else [], metrics)]
    else:
        ids = candidates_for(req.audience, period)
        if len(ids) == 1:
            result = (await asyncio.gather(calculate("fastest"), return_exceptions=True))[0]
            fast, fast_m = choose("fastest", checked(result))
            output = [serialize(fast, "fastest", True, ["fastest"], fast_m)]
        else:
            candidate = ids[0]
            fast_result, cand_result = await asyncio.gather(calculate("fastest"), calculate(candidate), return_exceptions=True)
            fast, fast_m = choose("fastest", checked(fast_result))
            if isinstance(cand_result, Exception) or not cand_result:
                if isinstance(cand_result, Exception):
                    logger.error("候選路線引擎錯誤類型: %s", type(cand_result).__name__)
                notes.append("no_better_route")
                output = [serialize(fast, "fastest", True, ["fastest"], fast_m)]
            else:
                cand, cand_m = choose(candidate, cand_result)
                diff = diff_of(cand, cand_m, fast, fast_m)
                reasons = reasons_for(candidate, cand_m, fast_m, diff)
                if same_route(cand, fast) or not reasons:
                    notes.append("no_better_route")
                    output = [serialize(fast, "fastest", True, ["fastest"], fast_m)]
                else:
                    too_long = detour_too_long(cand, fast)
                    fastest = serialize(fast, "fastest", too_long, ["fastest"], fast_m)
                    alternative = serialize(cand, candidate, not too_long, reasons, cand_m, diff)
                    output = [fastest, alternative] if too_long else [alternative, fastest]
    if simulated:
        notes.append("simulated_night")
    return {"context": {"audience": req.audience, "period": period, "simulated": simulated},
            "routes": output, "notes": notes,
            "sources": [{"name": "OpenStreetMap", "updatedAt": os.environ.get("OSM_UPDATED_AT")}]} 
