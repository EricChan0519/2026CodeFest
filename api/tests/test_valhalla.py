import asyncio
import json
import logging
from pathlib import Path

import httpx
import pytest

from app.adapters import valhalla
from app.adapters.valhalla import ValhallaEngine, decode_polyline6, map_maneuver
from app.engine import Maneuver, PedestrianCosting, RouteNotFound, RoutingUnavailable

ROUTE = json.loads((Path(__file__).parent / "fixtures" / "valhalla_route.json").read_text(encoding="utf-8"))
A, B = (25.0478, 121.5170), (25.0405, 121.5190)


def engine(handler):
    return ValhallaEngine("http://routing", transport=httpx.MockTransport(handler))


def run_route(handler, **kw):
    return asyncio.run(engine(handler).route(A, B, kw.pop("costing", PedestrianCosting()), **kw))


def ok(_req):
    return httpx.Response(200, json=ROUTE)


def test_decode_polyline6():
    assert decode_polyline6("_izlhA~rlgdF_{geC~ywl@") == [(38.5, -120.2), (40.7, -120.95)]


def test_decode_empty_polyline():
    assert decode_polyline6("") == []


@pytest.mark.parametrize("t,kind", [(1, "depart"), (3, "depart"), (4, "arrive"), (6, "arrive"), (7, "straight"),
    (8, "straight"), (9, "slight_right"), (10, "right"), (11, "right"), (12, "uturn"), (13, "uturn"), (14, "left"),
    (15, "left"), (16, "slight_left"), (40, "stairs"), (99, "straight")])
def test_map_maneuver(t, kind):
    assert map_maneuver(t) == kind


def test_route_converts_to_engine_route():
    r = run_route(ok)[0]
    assert r.distance_m == 250 and r.duration_s == 180.5
    assert r.geometry == [(38.5, -120.2), (40.7, -120.95)]
    assert r.maneuvers[0] == Maneuver("depart", 0, 100.0, "中山北路")
    assert r.maneuvers[1] == Maneuver("left", 1, 150.0, None)
    assert r.maneuvers[2].kind == "arrive"


def test_alternates_follow_main_route():
    routes = run_route(ok, alternates=2)
    assert [r.distance_m for r in routes] == [250, 300]


def test_request_body_translates_costing():
    seen = {}

    def handler(req):
        seen.update(json.loads(req.content), path=req.url.path)
        return ok(req)

    run_route(handler, costing=PedestrianCosting(use_lit=0.8, step_penalty=120.0, walking_speed_kmh=3.5), alternates=2)
    assert seen["path"] == "/route"
    assert seen["locations"] == [{"lat": A[0], "lon": A[1]}, {"lat": B[0], "lon": B[1]}]
    assert seen["costing"] == "pedestrian" and seen["units"] == "kilometers" and seen["alternates"] == 2
    p = seen["costing_options"]["pedestrian"]
    assert p["walking_speed"] == 3.5 and p["use_lit"] == 0.8 and p["step_penalty"] == 120.0
    assert "elevator_penalty" not in p and "walking_speed_kmh" not in p


@pytest.mark.parametrize("code", [170, 171, 442])
def test_no_path_raises_route_not_found(code):
    with pytest.raises(RouteNotFound):
        run_route(lambda r: httpx.Response(400, json={"error_code": code, "error": "x"}))


@pytest.mark.parametrize("resp", [httpx.Response(500, text="boom"), httpx.Response(400, json={"error_code": 100}),
    httpx.Response(200, text="not json"), httpx.Response(200, json={"trip": {"legs": []}})])
def test_bad_responses_raise_unavailable(resp):
    with pytest.raises(RoutingUnavailable):
        run_route(lambda r: resp)


@pytest.mark.parametrize("exc", [httpx.ReadTimeout("t"), httpx.ConnectError("c")])
def test_network_failures_raise_unavailable(exc):
    def handler(_req):
        raise exc

    with pytest.raises(RoutingUnavailable):
        run_route(handler)


def test_failure_does_not_leak_coordinates(caplog):
    caplog.set_level(logging.DEBUG)

    def handler(_req):
        return httpx.Response(500, text=f"failed at {A[0]},{A[1]}")

    with pytest.raises(RoutingUnavailable) as e:
        run_route(handler)
    assert str(A[0]) not in str(e.value) and e.value.__cause__ is None and e.value.__suppress_context__
    assert str(A[0]) not in caplog.text


def test_ping():
    assert asyncio.run(engine(lambda r: httpx.Response(200, json={})).ping()) is True
    assert asyncio.run(engine(lambda r: httpx.Response(503)).ping()) is False

    def down(_req):
        raise httpx.ConnectError("c")

    assert asyncio.run(engine(down).ping()) is False


def test_real_taipei_response_converts():
    """Captured from the real image: Taipei Main Station to a stop 1 km south."""
    real = json.loads((Path(__file__).parent / "fixtures" / "valhalla_taipei_route.json").read_text(encoding="utf-8"))
    r = run_route(lambda _req: httpx.Response(200, json=real))[0]
    assert r.distance_m == 1152 and 24.96 < r.geometry[0][0] < 25.21 and 121.45 < r.geometry[0][1] < 121.67
    assert r.maneuvers[0].kind == "depart" and r.maneuvers[-1].kind == "arrive"
    assert all(0 <= m.at_index < len(r.geometry) for m in r.maneuvers)
    assert any(m.kind == "stairs" for m in r.maneuvers)
    assert any(m.street for m in r.maneuvers)


class _Iam:
    """Fake metadata server plus routing service, behind one transport."""

    def __init__(self, metadata_status=200):
        self.metadata_status = metadata_status
        self.metadata_calls = []
        self.routing_auth = []

    def __call__(self, req):
        if req.url.host == "metadata.google.internal":
            self.metadata_calls.append(req)
            return httpx.Response(self.metadata_status, text=f"token-{len(self.metadata_calls)}")
        self.routing_auth.append(req.headers.get("authorization"))
        return httpx.Response(200, json=ROUTE)

    def engine(self):
        return ValhallaEngine("https://routing.example", transport=httpx.MockTransport(self), iam_auth=True)

    def route(self):
        return asyncio.run(self.engine().route(A, B, PedestrianCosting()))


@pytest.fixture(autouse=True)
def _clear_token_cache():
    valhalla._token_cache.clear()


def test_no_auth_header_without_iam():
    seen = {}

    def handler(req):
        seen["auth"] = req.headers.get("authorization")
        return ok(req)

    run_route(handler)
    assert seen["auth"] is None


def test_iam_sends_identity_token_for_the_service():
    iam = _Iam()
    iam.route()
    meta = iam.metadata_calls[0]
    assert meta.headers["metadata-flavor"] == "Google"
    assert meta.url.params["audience"] == "https://routing.example"
    assert iam.routing_auth == ["Bearer token-1"]


def test_iam_token_is_reused_across_engines_until_it_nears_expiry(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(valhalla.time, "monotonic", lambda: now[0])
    iam = _Iam()
    iam.route()
    iam.route()
    assert len(iam.metadata_calls) == 1
    now[0] += 3600
    iam.route()
    assert len(iam.metadata_calls) == 2 and iam.routing_auth[-1] == "Bearer token-2"


def test_iam_token_failure_means_unavailable():
    iam = _Iam(metadata_status=500)
    with pytest.raises(RoutingUnavailable):
        iam.route()
    assert iam.routing_auth == []


def test_ping_is_false_when_token_fails():
    assert asyncio.run(_Iam(metadata_status=500).engine().ping()) is False


def test_iam_auth_comes_from_environment(monkeypatch):
    monkeypatch.setenv("ROUTING_AUTH", "iam")
    assert ValhallaEngine("https://r")._iam_auth is True
    monkeypatch.delenv("ROUTING_AUTH")
    assert ValhallaEngine("https://r")._iam_auth is False
