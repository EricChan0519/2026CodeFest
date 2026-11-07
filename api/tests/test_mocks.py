"""檢查前端測試資料的合約與特殊情境。"""
import json
from pathlib import Path
import pytest
from app.geo import haversine_m

MOCKS = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks"
IDS = {"fastest", "fewer_steps_hills", "fewer_steps_hills_bright", "fewer_unsignalized", "fewer_unsignalized_bright", "bright"}
REASONS = {"fastest", "fewer_steps", "flatter", "brighter", "fewer_unsignalized_crossings", "extra_distance"}
KINDS = {"depart", "straight", "slight_left", "slight_right", "left", "right", "uturn", "stairs", "arrive"}
BEARINGS = {"E", "W", "S", "N", "SE", "NE", "SW", "NW", None}


def load(name):
    return json.loads((MOCKS / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["routes-one", "routes-many", "routes-no-better"])
def test_routes_contract(name):
    body = load(name)
    context = body["context"]
    assert context["audience"] in {"elder", "child", "visitor"}
    assert context["period"] in {"day", "night"} and isinstance(context["simulated"], bool)
    assert isinstance(body["sources"], list)
    assert set(body["notes"]) <= {"no_better_route", "simulated_night"}
    routes = body["routes"]
    assert routes and routes[0]["recommended"] is True and sum(r["recommended"] for r in routes) == 1
    for r in routes:
        assert {"id", "recommended", "reasons", "distanceM", "durationS", "geometry", "maneuvers", "metrics", "diff"} <= r.keys()
        assert r["id"] in IDS and set(r["reasons"]) <= REASONS
        geometry = r["geometry"]
        assert geometry and all(len(p) == 2 and 24.96 <= p[0] <= 25.21 and 121.45 <= p[1] <= 121.67 for p in geometry)
        assert all(haversine_m(a, b) <= 50 for a, b in zip(geometry, geometry[1:]))
        maneuvers = r["maneuvers"]
        assert maneuvers and maneuvers[0]["kind"] == "depart" and maneuvers[-1]["kind"] == "arrive"
        assert maneuvers[-1]["atIndex"] == len(geometry) - 1
        assert all(m["kind"] in KINDS and 0 <= m["atIndex"] < len(geometry) for m in maneuvers)
        assert [m["atIndex"] for m in maneuvers] == sorted(m["atIndex"] for m in maneuvers)
        if r["metrics"] is not None:
            assert {"steps", "climbM", "litRatio", "unsignalizedCrossings", "signalCrossings", "unknownCrossings"} <= r["metrics"].keys()
        if r["diff"] is not None:
            assert {"distanceM", "durationS", "steps", "climbM", "unsignalizedCrossings"} <= r["diff"].keys()
        assert (r["diff"] is None) == (r["id"] == "fastest")


def test_route_scenarios():
    one = load("routes-one")["routes"]
    assert len(one) == 1 and one[0]["id"] == "fastest" and one[0]["metrics"] is None and one[0]["diff"] is None and one[0]["reasons"] == ["fastest"]
    many = load("routes-many")
    assert many["context"]["audience"] == "elder" and many["context"]["period"] == "night"
    assert len(many["routes"]) == 2 and all(r["metrics"] is not None for r in many["routes"])
    assert next(r for r in many["routes"] if r["recommended"])["id"] == "fewer_steps_hills_bright"
    no = load("routes-no-better")
    assert len(no["routes"]) == 1 and no["routes"][0]["id"] == "fastest" and no["notes"] == ["no_better_route"]


@pytest.mark.parametrize("name,nearby", [("stations-nearby", True), ("stations-search", False)])
def test_station_contract(name, nearby):
    body = load(name)
    assert {"name", "updatedAt"} <= body["source"].keys()
    assert body["stations"]
    for s in body["stations"]:
        assert {"stationUid", "name", "bearing", "lat", "lon", "routes"} <= s.keys()
        assert s["stationUid"] and s["name"]["zh"] and {"zh", "en"} <= s["name"].keys()
        assert s["bearing"] in BEARINGS and 24.96 <= s["lat"] <= 25.21 and 121.45 <= s["lon"] <= 121.67
        assert ("distanceM" in s) == nearby
        for route in s["routes"]:
            assert {"routeName", "direction", "headsign", "stopUid"} <= route.keys()
            assert {"zh", "en"} <= route["routeName"].keys() and {"zh", "en"} <= route["headsign"].keys()
            assert route["direction"] in {0, 1, 2, 10, 255}
    if nearby:
        distances = [s["distanceM"] for s in body["stations"]]
        assert distances == sorted(distances)
    else:
        stations = body["stations"]
        assert any(a["name"]["zh"] == b["name"]["zh"] and a["stationUid"] != b["stationUid"] for a in stations for b in stations)
        assert any(s["name"]["en"] is None for s in stations)
        assert any(s["bearing"] is None for s in stations)
