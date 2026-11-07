"""Valhalla adapter: the only place that knows Valhalla's request and response format.

Never log or raise anything that contains coordinates (ADR-0005).
"""
import math
import os
import time
from dataclasses import asdict

import httpx

from app.engine import (
    EdgeInfo,
    EngineRoute,
    LatLon,
    Maneuver,
    ManeuverKind,
    PedestrianCosting,
    RouteNotFound,
    RoutingUnavailable,
)

# 170 unconnected regions, 171 no suitable edges near location, 442 no path found.
_NO_PATH_CODES = {170, 171, 442}

_MANEUVER_KINDS: dict[int, ManeuverKind] = {
    1: "depart", 2: "depart", 3: "depart",
    4: "arrive", 5: "arrive", 6: "arrive",
    7: "straight", 8: "straight",
    9: "slight_right",
    10: "right", 11: "right",
    12: "uturn", 13: "uturn",
    14: "left", 15: "left",
    16: "slight_left",
    # same as web/src/lib/walkRoute.ts mapManeuverType: ramps/exits and "stay" count as turns
    18: "right", 20: "right", 23: "slight_right",
    19: "left", 21: "left", 24: "slight_left",
    40: "stairs",
}


_EDGE_ATTRIBUTES = ["edge.use", "edge.road_class", "edge.length",
                    "edge.begin_shape_index", "edge.end_shape_index", "shape"]

_METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
)
# Google ID tokens live 1 hour; refresh before that. Module-level so it survives per-request engines.
_TOKEN_TTL_S = 3000
_token_cache: dict[str, tuple[str, float]] = {}


def decode_polyline6(encoded: str) -> list[LatLon]:
    points: list[LatLon] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append((lat / 1e6, lon / 1e6))
    return points


def map_maneuver(valhalla_type: int) -> ManeuverKind:
    return _MANEUVER_KINDS.get(valhalla_type, "straight")


def _costing_options(costing: PedestrianCosting) -> dict:
    options = {k: v for k, v in asdict(costing).items() if v is not None}
    options["walking_speed"] = options.pop("walking_speed_kmh")
    return {"pedestrian": options}


def _to_route(trip: dict) -> EngineRoute:
    leg = trip["legs"][0]
    return EngineRoute(
        shape=leg["shape"],
        distance_m=trip["summary"]["length"] * 1000,
        duration_s=trip["summary"]["time"],
        geometry=decode_polyline6(leg["shape"]),
        maneuvers=[
            Maneuver(
                kind=map_maneuver(m["type"]),
                at_index=m["begin_shape_index"],
                distance_to_next_m=m["length"] * 1000,
                street=(m.get("street_names") or [None])[0],
            )
            for m in leg["maneuvers"]
        ],
    )


#: trace_attributes 的點離路線上對應的點超過這麼遠，就當成對不上
_INDEX_MAP_MAX_M = 30.0


def _index_map(trace: list[LatLon], route: list[LatLon]) -> list[int] | None:
    """trace_attributes 的 shape 索引 → 路線 geometry 的索引。

    edge_walk 有時會多插一個點（例如 63 點的路線回 64 點），索引就差一。依序找最近的路線點（只往前不往回），
    每個點都要在 _INDEX_MAP_MAX_M 內，否則回 None。點數相同時就是原本的索引。"""
    if not trace or not route:
        return None
    if len(trace) == len(route):
        return list(range(len(route)))
    scale = math.cos(math.radians(route[0][0]))
    def metres(a: LatLon, b: LatLon) -> float:
        return math.hypot((a[0] - b[0]) * 111_195, (a[1] - b[1]) * 111_195 * scale)
    out, j = [], 0
    for point in trace:
        while j + 1 < len(route) and metres(point, route[j + 1]) <= metres(point, route[j]):
            j += 1
        if metres(point, route[j]) > _INDEX_MAP_MAX_M:
            return None
        out.append(j)
    return out


class ValhallaEngine:
    def __init__(self, base_url: str | None = None, timeout_s: float | None = None, transport=None,
                 iam_auth: bool | None = None):
        self._base_url = base_url or os.environ.get("ROUTING_URL", "")
        self._timeout_s = timeout_s or float(os.environ.get("ROUTING_TIMEOUT_S", "8"))
        self._transport = transport
        self._iam_auth = os.environ.get("ROUTING_AUTH") == "iam" if iam_auth is None else iam_auth

    async def _client(self) -> httpx.AsyncClient:
        """routing is a private Cloud Run service: on Cloud Run, send an identity token for it."""
        headers = {"Authorization": f"Bearer {await self._identity_token()}"} if self._iam_auth else None
        return httpx.AsyncClient(
            base_url=self._base_url, timeout=self._timeout_s, transport=self._transport, headers=headers
        )

    async def _identity_token(self) -> str:
        cached = _token_cache.get(self._base_url)
        if cached and time.monotonic() < cached[1]:
            return cached[0]
        async with httpx.AsyncClient(timeout=self._timeout_s, transport=self._transport) as client:
            response = await client.get(
                _METADATA_IDENTITY_URL,
                params={"audience": self._base_url},
                headers={"Metadata-Flavor": "Google"},
            )
        response.raise_for_status()
        _token_cache[self._base_url] = (response.text, time.monotonic() + _TOKEN_TTL_S)
        return response.text

    async def route(self, origin: LatLon, dest: LatLon, costing: PedestrianCosting, alternates: int = 0,
                    via: list[LatLon] | None = None) -> list[EngineRoute]:
        # "through": pass the point without stopping or splitting the route into legs
        middle = [{"lat": lat, "lon": lon, "type": "through"} for lat, lon in via or []]
        body = {
            "locations": [{"lat": origin[0], "lon": origin[1]}, *middle, {"lat": dest[0], "lon": dest[1]}],
            "costing": "pedestrian",
            "costing_options": _costing_options(costing),
            "units": "kilometers",
        }
        if alternates and not middle:  # Valhalla only gives alternates for two locations
            body["alternates"] = alternates

        # Failures raise from None: exception chains could carry the request body into logs.
        try:
            async with await self._client() as client:
                response = await client.post("/route", json=body)
            data = response.json()
        except (httpx.HTTPError, ValueError):
            raise RoutingUnavailable("routing request failed") from None

        if response.status_code != 200:
            code = data.get("error_code") if isinstance(data, dict) else None
            if code in _NO_PATH_CODES:
                raise RouteNotFound("no walking path") from None
            raise RoutingUnavailable("routing engine error") from None

        try:
            trips = [data["trip"], *(alt["trip"] for alt in data.get("alternates", []))]
            return [_to_route(trip) for trip in trips]
        except (KeyError, IndexError, TypeError, ValueError):
            raise RoutingUnavailable("unexpected routing response") from None

    async def edges(self, route: EngineRoute) -> list[EdgeInfo] | None:
        """trace_attributes on the route's own shape. Returns None when the indexes do not line up."""
        if not route.shape:
            return None
        body = {
            "encoded_polyline": route.shape,
            "shape_match": "edge_walk",
            "costing": "pedestrian",
            "filters": {"attributes": _EDGE_ATTRIBUTES, "action": "include"},
        }
        try:
            async with await self._client() as client:
                response = await client.post("/trace_attributes", json=body)
            if response.status_code != 200:
                return None
            data = response.json()
            index = _index_map(decode_polyline6(data["shape"]), route.geometry)
            if index is None:
                return None
            edges = [EdgeInfo(begin=index[int(e["begin_shape_index"])], end=index[int(e["end_shape_index"])],
                              use=e.get("use"), road_class=e.get("road_class"),
                              length_m=float(e.get("length") or 0) * 1000)
                     for e in data["edges"]]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
            return None
        return edges

    async def ping(self) -> bool:
        try:
            async with await self._client() as client:
                return (await client.get("/status")).status_code == 200
        except httpx.HTTPError:
            return False
