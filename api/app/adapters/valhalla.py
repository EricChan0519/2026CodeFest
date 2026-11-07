"""Valhalla adapter: the only place that knows Valhalla's request and response format.

Never log or raise anything that contains coordinates (ADR-0005).
"""
import os
import time
from dataclasses import asdict

import httpx

from app.engine import (
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
    40: "stairs",
}


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

    async def route(self, origin: LatLon, dest: LatLon, costing: PedestrianCosting, alternates: int = 0) -> list[EngineRoute]:
        body = {
            "locations": [{"lat": origin[0], "lon": origin[1]}, {"lat": dest[0], "lon": dest[1]}],
            "costing": "pedestrian",
            "costing_options": _costing_options(costing),
            "units": "kilometers",
        }
        if alternates:
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

    async def ping(self) -> bool:
        try:
            async with await self._client() as client:
                return (await client.get("/status")).status_code == 200
        except httpx.HTTPError:
            return False
