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


def _day(weekday, weekend):
    d = {k: int(weekday) for k in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")}
    d.update({k: int(weekend) for k in ("Saturday", "Sunday")})
    return d


def test_service_windows_from_timetables_and_frequencies():
    schedule = [
        {"RouteName": {"Zh_tw": "307"}, "Direction": 0, "Timetables": [
            {"ServiceDay": _day(True, False), "StopTimes": [{"StopSequence": 2, "DepartureTime": "05:40"}, {"StopSequence": 1, "DepartureTime": "05:30"}]},
            {"ServiceDay": _day(True, True), "StopTimes": [{"StopSequence": 1, "DepartureTime": "22:45"}]},
            {"ServiceDay": _day(False, True), "StopTimes": [{"StopSequence": 1, "ArrivalTime": "06:10"}]},
        ]},
        {"RouteName": {"Zh_tw": "307"}, "Direction": 1, "Frequencys": [
            {"StartTime": "06:00", "EndTime": "00:30", "ServiceDay": _day(True, True)},
        ]},
    ]
    w = builder.service_windows(schedule)
    assert w[("307", 0)] == {"weekday": [5 * 3600 + 30 * 60, 22 * 3600 + 45 * 60], "weekend": [6 * 3600 + 10 * 60, 22 * 3600 + 45 * 60]}
    assert w[("307", 1)] == {"weekday": [6 * 3600, 24 * 3600 + 30 * 60], "weekend": [6 * 3600, 24 * 3600 + 30 * 60]}


def test_patterns_get_service_windows_when_schedule_is_given():
    schedule = [{"RouteName": {"Zh_tw": load("stop_of_route")[0]["RouteName"]["Zh_tw"]}, "Direction": load("stop_of_route")[0]["Direction"],
                 "Frequencys": [{"StartTime": "06:00", "EndTime": "22:00", "ServiceDay": _day(True, True)}]}]
    result = builder._build(load("stop_of_route"), load("stop"), load("route"), "x", schedule)[0]
    with_service = [p for p in result["patterns"] if "service" in p]
    assert with_service and with_service[0]["service"]["weekday"] == [6 * 3600, 22 * 3600]


def test_missing_return_direction_borrows_the_other_direction():
    # TDX 很多路線只給去程班表：回程借去程的首末班（估計）
    w = {("37", 0): {"weekday": [5 * 3600, 22 * 3600], "weekend": None},
         ("9", 1): {"weekday": None, "weekend": None}}
    assert builder.window_for(w, "37", 1) == {"weekday": [5 * 3600, 22 * 3600], "weekend": None}
    assert builder.window_for(w, "37", 0) == {"weekday": [5 * 3600, 22 * 3600], "weekend": None}
    assert builder.window_for(w, "9", 1) is None
    assert builder.window_for(w, "9", 0) is None
