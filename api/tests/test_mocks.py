"""前端 mock 必須符合 03 合約；之後 API 實作的回應也用同一組檢查。"""
import json
from pathlib import Path

import pytest

MOCKS = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks"
KINDS = {"depart", "straight", "slight_left", "slight_right", "left", "right", "uturn", "stairs", "arrive"}
BEARINGS = {"E", "W", "S", "N", "SE", "NE", "SW", "NW", None}


def load(name):
    return json.loads((MOCKS / f"{name}.json").read_text(encoding="utf-8"))


def check_routes(body):
    routes = body["routes"]
    assert routes and routes[0]["recommended"] is True
    assert sum(r["recommended"] for r in routes) == 1
    assert set(body["notes"]) <= {"no_better_route", "simulated_night"}
    for r in routes:
        g = r["geometry"]
        assert all(len(p) == 2 and 24 < p[0] < 26 and 121 < p[1] < 122 for p in g)  # [lat, lon]
        for m in r["maneuvers"]:
            assert m["kind"] in KINDS and 0 <= m["atIndex"] < len(g)
        assert (r["diff"] is None) == (r["id"] == "fastest")


def check_stations(body, with_distance):
    for s in body["stations"]:
        assert s["stationUid"] and s["name"]["zh"] and s["bearing"] in BEARINGS
        assert ("distanceM" in s) == with_distance
        for rt in s["routes"]:
            assert rt["direction"] in {0, 1, 2, 10, 255}


@pytest.mark.parametrize("name", ["routes-one", "routes-many", "routes-no-better"])
def test_route_mocks_follow_contract(name):
    check_routes(load(name))


def test_stage1_mock_has_no_metrics():
    assert all(r["metrics"] is None for r in load("routes-one")["routes"])


def test_no_better_mock_has_note():
    assert load("routes-no-better")["notes"] == ["no_better_route"]


def test_nearby_mock_sorted_with_distance():
    body = load("stations-nearby")
    check_stations(body, with_distance=True)
    d = [s["distanceM"] for s in body["stations"]]
    assert d == sorted(d)


def test_search_mock_has_no_distance():
    check_stations(load("stations-search"), with_distance=False)
