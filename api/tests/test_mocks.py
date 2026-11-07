"""檢查前端測試資料的合約與特殊情境。"""
import json
from pathlib import Path
import pytest
from app.geo import haversine_m

MOCKS = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks"
from contract_checks import check_routes, check_stations


def load(name):
    return json.loads((MOCKS / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["routes-one", "routes-many", "routes-no-better"])
def test_routes_contract(name):
    check_routes(load(name))


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
    check_stations(body, nearby)
    if not nearby:
        stations = body["stations"]
        assert any(a["name"]["zh"] == b["name"]["zh"] and a["stationUid"] != b["stationUid"] for a in stations for b in stations)
        assert any(s["name"]["en"] is None for s in stations)
        assert any(s["bearing"] is None for s in stations)
