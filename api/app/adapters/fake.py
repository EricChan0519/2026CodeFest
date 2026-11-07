"""不連網的可預測路線引擎，供本機開發與測試。"""
from math import ceil
from typing import Literal

from app.engine import EngineRoute, LatLon, Maneuver, PedestrianCosting, RouteNotFound, RoutingUnavailable
from app.geo import haversine_m


def _length(points: list[LatLon]) -> float:
    return sum(haversine_m(a, b) for a, b in zip(points, points[1:]))


def _segment(a: LatLon, b: LatLon) -> list[LatLon]:
    count = max(1, ceil(haversine_m(a, b) / 19))
    return [(a[0] + (b[0] - a[0]) * i / count,
             a[1] + (b[1] - a[1]) * i / count) for i in range(1, count)] + [b]


class FakeEngine:
    def __init__(self, mode: Literal["ok", "no_route", "down"] = "ok"):
        self.mode = mode
        self.calls: list[dict] = []

    @property
    def last(self) -> dict | None:
        return self.calls[-1] if self.calls else None

    async def ping(self) -> bool:
        return self.mode != "down"

    async def route(self, origin: LatLon, dest: LatLon, costing: PedestrianCosting,
                    alternates: int = 0) -> list[EngineRoute]:
        self.calls.append({"origin": origin, "dest": dest, "costing": costing, "alternates": alternates})
        if self.mode == "no_route":
            raise RouteNotFound()
        if self.mode == "down":
            raise RoutingUnavailable()
        if haversine_m(origin, dest) < 1:
            return [EngineRoute(0, 0, [origin], [Maneuver("depart", 0, 0, "範例路"),
                    Maneuver("arrive", 0, 0, None)]) for _ in range(1 + alternates)]
        routes = []
        for k in range(1 + alternates):
            corner = (dest[0], origin[1]) if k == 0 else (origin[0], dest[1])
            if k >= 2:
                corner = (corner[0] + k * 30 / 111195, corner[1])
            first = [origin] + (_segment(origin, corner) if origin != corner else [])
            second = _segment(corner, dest) if corner != dest else []
            geometry = first + second
            distance = _length(geometry)
            maneuvers = [Maneuver("depart", 0, _length(first) if second and len(first) > 1 else distance, "範例路")]
            if len(first) > 1 and second:
                # 以東、北向量的外積判斷左右；共線時略過轉彎。
                ax, ay = corner[1] - origin[1], corner[0] - origin[0]
                bx, by = dest[1] - corner[1], dest[0] - corner[0]
                cross = ax * by - ay * bx
                if cross:
                    maneuvers.append(Maneuver("left" if cross > 0 else "right", len(first) - 1,
                                              _length([corner] + second), "範例街"))
                else:
                    maneuvers[0] = Maneuver("depart", 0, distance, "範例路")
            maneuvers.append(Maneuver("arrive", len(geometry) - 1, 0, None))
            routes.append(EngineRoute(distance, distance / (costing.walking_speed_kmh / 3.6), geometry, maneuvers))
        return routes
