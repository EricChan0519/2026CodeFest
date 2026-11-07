"""階段一路線計算及合約轉換。"""
import logging
import os
from datetime import datetime

from app.engine import RouteNotFound, RoutingEngine, RoutingUnavailable
from app.errors import ApiError
from app.geo import in_area
from app.route_rules import costing_for, period_of
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


async def plan_routes(req: RoutesRequest, engine: RoutingEngine, now: datetime) -> dict:
    origin, dest = (req.from_.lat, req.from_.lon), (req.to.lat, req.to.lon)
    if not in_area(*origin) or not in_area(*dest):
        raise ApiError("OUT_OF_AREA", 400)
    try:
        routes = await engine.route(origin, dest, costing_for("fastest", req.audience), alternates=0)
    except RouteNotFound:
        raise ApiError("ROUTE_NOT_FOUND", 404) from None
    except RoutingUnavailable:
        raise ApiError("ROUTING_UNAVAILABLE", 503) from None
    except Exception as exc:
        logger.error("路線引擎錯誤類型: %s", type(exc).__name__)
        raise ApiError("ROUTING_UNAVAILABLE", 503) from None
    if not routes:
        raise ApiError("ROUTE_NOT_FOUND", 404)
    simulated = req.simulate == "night"
    return {"context": {"audience": req.audience, "period": period_of(now, req.simulate), "simulated": simulated},
            "routes": [route_to_dict(routes[0], "fastest", True, ["fastest"], None, None)],
            "notes": ["simulated_night"] if simulated else [],
            "sources": [{"name": "OpenStreetMap", "updatedAt": os.environ.get("OSM_UPDATED_AT")}]} 
