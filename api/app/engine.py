import os

from dataclasses import dataclass
from typing import Literal, Protocol

LatLon = tuple[float, float]                # (lat, lon)，WGS84

ManeuverKind = Literal["depart", "straight", "slight_left", "slight_right",
                       "left", "right", "uturn", "stairs", "arrive"]

@dataclass(frozen=True)
class PedestrianCosting:                    # 欄位名稱沿用 02 的權重表
    walkway_factor: float = 1.0
    sidewalk_factor: float = 1.0
    alley_factor: float = 2.0
    driveway_factor: float = 5.0
    use_hills: float = 0.5
    use_lit: float = 0.0
    step_penalty: float | None = None       # None：用引擎預設
    elevator_penalty: float | None = None
    walking_speed_kmh: float = 5.1          # 長者 3.5

@dataclass(frozen=True)
class Maneuver:
    kind: ManeuverKind
    at_index: int                           # geometry 的索引
    distance_to_next_m: float
    street: str | None

@dataclass(frozen=True)
class EngineRoute:
    distance_m: float
    duration_s: float
    geometry: list[LatLon]                  # 已解碼，不是 polyline 字串
    maneuvers: list[Maneuver]

class RouteNotFound(Exception): ...         # A 轉成 404 ROUTE_NOT_FOUND
class RoutingUnavailable(Exception): ...    # A 轉成 503 ROUTING_UNAVAILABLE

class RoutingEngine(Protocol):
    async def route(self, origin: LatLon, dest: LatLon,
                    costing: PedestrianCosting, alternates: int = 0) -> list[EngineRoute]:
        """第一筆是主路線，之後是 alternates。至少回一筆，否則丟 RouteNotFound。"""
    async def ping(self) -> bool:
        """/api/health?deep=1 使用。不丟例外，失敗回 False。"""

def get_engine() -> RoutingEngine:
    """依 ROUTING_ENGINE 選擇引擎。

    B 的 ValhallaEngine、OsrmEngine 使用無參數建構，並自行讀取
    ROUTING_URL 與 ROUTING_TIMEOUT_S。
    """
    name = os.environ.get("ROUTING_ENGINE", "fake").strip().lower()
    if name == "fake":
        from app.adapters.fake import FakeEngine
        return FakeEngine()
    if name == "valhalla":
        from app.adapters.valhalla import ValhallaEngine
        return ValhallaEngine()
    if name == "osrm":
        from app.adapters.osrm import OsrmEngine
        return OsrmEngine()
    raise ValueError("ROUTING_ENGINE 允許值：fake、valhalla、osrm")
