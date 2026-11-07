import asyncio
import json
from pathlib import Path

from scripts import build_stop_index as builder
from contract_checks import check_stations

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIXTURES / ("tdx_" + name + ".json")).read_text(encoding="utf-8"))


def test_build_index():
    result, excluded, missing = builder._build(load("stop_of_route"), load("stop"), load("route"), "2026-11-07T10:00:00+08:00")
    assert result == builder.build_index(load("stop_of_route"), load("stop"), load("route"), result["updatedAt"])
    assert excluded == 1 and missing == 1
    first, second = result["stations"]
    assert [first["stationUid"],second["stationUid"]] == ["TPE1","TPE2"]
    assert first["name"]["zh"] == second["name"]["zh"] and second["name"]["en"] is None
    assert first["bearing"] == "E" and second["bearing"] is None
    assert first["lat"] == 25.101 and first["lon"] == 121.5
    assert len(first["routes"]) == 4
    assert all(r["routeName"]["en"] is None for r in first["routes"])
    assert next(r for r in first["routes"] if r["direction"] == 0)["headsign"] == {"zh":"往終點","en":"To End"}
    assert next(r for r in first["routes"] if r["direction"] == 1)["headsign"] == {"zh":"往起點","en":"To Start"}
    assert next(r for r in first["routes"] if r["direction"] == 255)["headsign"] == {"zh":None,"en":None}
    assert all("distanceM" not in s for s in result["stations"])
    check_stations({"stations":result["stations"],"source":{"name":"TDX","updatedAt":result["updatedAt"]}}, False)


def test_missing_names_and_invalid_direction():
    routes = load("route")
    routes[0]["DestinationStopNameZh"] = ""
    routes[0]["DestinationStopNameEn"] = ""
    data = load("stop_of_route")[:1]
    data[0]["Direction"] = 42
    result = builder.build_index(data, load("stop"), routes, "x")
    assert result["stations"][0]["routes"][0]["direction"] == 255
    assert result["stations"][0]["routes"][0]["headsign"] == {"zh":None,"en":None}


def test_pagination(monkeypatch):
    calls = []
    async def fake(path, params):
        calls.append((path,params))
        return [1] * 5000 if params["$skip"] == 0 else [2]
    monkeypatch.setattr(builder, "tdx_get", fake)
    assert len(asyncio.run(builder.fetch_all("/test"))) == 5001
    assert [x[1]["$skip"] for x in calls] == [0,5000]


def test_patterns_keep_stop_order_per_route_direction():
    result = builder.build_index(load("stop_of_route"), load("stop"), load("route"), "x")
    outbound = next(p for p in result["patterns"] if p["direction"] == 0)
    assert outbound["routeName"] == {"zh": "1", "en": None}
    assert outbound["headsign"] == {"zh": "往終點", "en": "To End"}
    # s1、s2 同站位會合併；s4 只能下車、所在站位沒有可上車路線，不在 stations 裡；s5 沒有 StationID
    assert outbound["stops"] == ["TPE1", "TPE2", "TPE1"]
    assert outbound["noBoard"] == [] and outbound["noAlight"] == []
    known = {s["stationUid"] for s in result["stations"]}
    assert all(uid in known for p in result["patterns"] for uid in p["stops"])


def test_patterns_follow_stop_sequence_and_boarding_flags():
    stops = [
        {"StopUID": "a", "StationID": "1", "StopName": {"Zh_tw": "甲"}, "StopBoarding": 0, "StopSequence": 3, "StopPosition": {"PositionLat": 25.0, "PositionLon": 121.5}},
        {"StopUID": "b", "StationID": "2", "StopName": {"Zh_tw": "乙"}, "StopBoarding": 1, "StopSequence": 1, "StopPosition": {"PositionLat": 25.1, "PositionLon": 121.5}},
        {"StopUID": "c", "StationID": "3", "StopName": {"Zh_tw": "丙"}, "StopBoarding": 0, "StopSequence": 2, "StopPosition": {"PositionLat": 25.2, "PositionLon": 121.5}},
    ]
    data = [{"RouteUID": "r", "RouteName": {"Zh_tw": "9"}, "Direction": 0, "Stops": stops}]
    pattern = builder.build_index(data, [], [], "x")["patterns"][0]
    assert pattern["stops"] == ["TPE2", "TPE3", "TPE1"]
    # b 只能上車：不能在那裡下車
    assert pattern["noAlight"] == [0] and pattern["noBoard"] == []


def test_identical_patterns_from_sub_routes_are_merged():
    data = load("stop_of_route")[:1] * 2
    result = builder.build_index(data, load("stop"), load("route"), "x")
    assert len([p for p in result["patterns"] if p["direction"] == 0]) == 1
