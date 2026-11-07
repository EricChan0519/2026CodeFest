"""build_metro_index：TDX 臺北捷運 → metro_index.json（格式見 docs/arrow-nav/03-contracts.md）。

TDX 欄位依 NYCU TDX 套件與 TDX v2 Metro 慣例撰寫；S2STravelTime、LineTransfer、StationExit、
Frequency、StationOfRoute 的欄位待用金鑰實測，讀不到時要退回預設值並寫進 defaults。
"""
from scripts import build_metro_index as b


def name(zh, en):
    return {"Zh_tw": zh, "En": en}


def pos(lat, lon):
    return {"PositionLat": lat, "PositionLon": lon}


STATIONS = [
    {"StationID": "BL11", "StationName": name("西門", "Ximen"), "StationPosition": pos(25.0421, 121.5081)},
    {"StationID": "BL12", "StationName": name("台北車站", "Taipei Main Station"), "StationPosition": pos(25.0463, 121.5174)},
    {"StationID": "BL13", "StationName": name("善導寺", "Shandao Temple"), "StationPosition": pos(25.0447, 121.5233)},
    {"StationID": "R09", "StationName": name("台大醫院", "NTU Hospital"), "StationPosition": pos(25.0417, 121.5163)},
    {"StationID": "R10", "StationName": name("台北車站", "Taipei Main Station"), "StationPosition": pos(25.0463, 121.5174)},
    {"StationID": "R11", "StationName": name("中山", "Zhongshan"), "StationPosition": pos(25.0527, 121.5203)},
]

LINES = [
    {"LineID": "BL", "LineName": name("板南線", "Bannan Line"), "LineColor": "#0070bd"},
    {"LineID": "R", "LineName": name("淡水信義線", "Tamsui-Xinyi Line")},
]

STATION_OF_LINE = [
    {"LineID": "BL", "Stations": [
        {"Sequence": 2, "StationID": "BL12"}, {"Sequence": 1, "StationID": "BL11"}, {"Sequence": 3, "StationID": "BL13"}]},
    {"LineID": "R", "Stations": [
        {"Sequence": 1, "StationID": "R09"}, {"Sequence": 2, "StationID": "R10"}, {"Sequence": 3, "StationID": "R11"}]},
]

S2S = [
    {"LineID": "BL", "TravelTimes": [
        {"FromStationID": "BL11", "ToStationID": "BL12", "RunTime": 100, "StopTime": 25},
        {"FromStationID": "BL12", "ToStationID": "BL13", "RunTime": 80, "StopTime": 30}]},
]

TRANSFERS = [
    {"FromLineID": "BL", "FromStationID": "BL12", "ToLineID": "R", "ToStationID": "R10", "MinTransferTime": 5},
]

EXITS = [
    {"StationID": "BL12", "ExitID": "M3", "ExitName": name("M3", "M3"), "ExitPosition": pos(25.0469, 121.5158), "Elevator": True},
    {"StationID": "BL12", "ExitID": "BAD", "ExitName": name("", ""), "ExitPosition": {}, "Elevator": False},
]

FREQUENCY = [
    {"LineID": "BL", "Headways": [{"MinHeadwayMins": 3, "MaxHeadwayMins": 5}, {"MinHeadwayMins": 6, "MaxHeadwayMins": 8}]},
]


def build(**overrides):
    args = dict(stations=STATIONS, lines=LINES, station_of_line=STATION_OF_LINE, station_of_route=None,
                s2s=S2S, transfers=TRANSFERS, exits=EXITS, frequency=FREQUENCY, updated_at="2026-11-07T23:30:00+08:00")
    args.update(overrides)
    return b.build_metro_index(**args)


def by_line(data, line):
    return [p for p in data["patterns"] if p["lineId"] == line]


def test_output_matches_contract():
    data = build()
    assert b.check_metro_index(data) == []
    assert data["updatedAt"] == "2026-11-07T23:30:00+08:00"


def test_stations_keep_names_and_coordinates():
    st = {s["stationId"]: s for s in build()["stations"]}
    assert st["BL12"]["name"] == {"zh": "台北車站", "en": "Taipei Main Station"}
    assert (st["BL12"]["lat"], st["BL12"]["lon"]) == (25.0463, 121.5174)


def test_patterns_are_ordered_by_sequence_in_both_directions():
    bl = by_line(build(), "BL")
    assert [p["stops"] for p in bl] == [["BL11", "BL12", "BL13"], ["BL13", "BL12", "BL11"]]
    assert bl[0]["headsign"] == {"zh": "往善導寺", "en": "To Shandao Temple"}
    assert bl[1]["headsign"] == {"zh": "往西門", "en": "To Ximen"}


def test_run_seconds_come_from_s2s_in_either_direction():
    bl = by_line(build(), "BL")
    assert bl[0]["runS"] == [125, 110]
    assert bl[1]["runS"] == [110, 125]


def test_missing_run_seconds_use_default_and_are_recorded():
    data = build()
    assert by_line(data, "R")[0]["runS"] == [b.DEFAULT_RUN_S, b.DEFAULT_RUN_S]
    assert "runS" in data["defaults"]


def test_line_colors_and_headways():
    lines = {l["lineId"]: l for l in build()["lines"]}
    assert lines["BL"]["color"] == "#0070BD"
    assert lines["R"]["color"] == b.OFFICIAL_COLORS["R"]
    assert lines["BL"]["headwayS"] == 330
    assert lines["R"]["headwayS"] == b.DEFAULT_HEADWAY_S


def test_transfers_are_two_way_and_in_seconds():
    t = build()["transfers"]
    assert {"from": "BL12", "to": "R10", "walkS": 300} in t
    assert {"from": "R10", "to": "BL12", "walkS": 300} in t


def test_without_line_transfer_data_same_name_stations_are_linked():
    data = build(transfers=None)
    assert {"from": "BL12", "to": "R10", "walkS": b.DEFAULT_TRANSFER_S} in data["transfers"]
    assert {"from": "R10", "to": "BL12", "walkS": b.DEFAULT_TRANSFER_S} in data["transfers"]
    assert "transfers" in data["defaults"]


def test_exits_skip_rows_without_position():
    st = {s["stationId"]: s for s in build()["stations"]}
    assert st["BL12"]["exits"] == [{"exitId": "M3", "name": "M3", "lat": 25.0469, "lon": 121.5158, "elevator": True}]
    assert st["R11"]["exits"] == []


def test_missing_optional_endpoints_fall_back_to_defaults():
    data = build(s2s=None, exits=None, frequency=None, transfers=None)
    assert b.check_metro_index(data) == []
    assert {"runS", "exits", "headwayS", "transfers"} <= set(data["defaults"])


def test_station_of_route_is_preferred_and_keeps_branches():
    sor = [
        {"RouteID": "BL-1", "LineID": "BL", "Direction": 0, "Stations": [
            {"Sequence": 1, "StationID": "BL11"}, {"Sequence": 2, "StationID": "BL12"}]},
        {"RouteID": "BL-1", "LineID": "BL", "Direction": 1, "Stations": [
            {"Sequence": 1, "StationID": "BL12"}, {"Sequence": 2, "StationID": "BL11"}]},
    ]
    bl = by_line(build(station_of_route=sor), "BL")
    assert [p["stops"] for p in bl] == [["BL11", "BL12"], ["BL12", "BL11"]]


def test_line_fallback_splits_branches_at_their_junction():
    stations = STATIONS + [
        {"StationID": "R22", "StationName": name("北投", "Beitou"), "StationPosition": pos(25.1320, 121.4986)},
        {"StationID": "R22A", "StationName": name("新北投", "Xinbeitou"), "StationPosition": pos(25.1369, 121.5025)},
    ]
    sol = [{"LineID": "R", "Stations": [
        {"Sequence": 1, "StationID": "R09"}, {"Sequence": 2, "StationID": "R10"}, {"Sequence": 3, "StationID": "R11"},
        {"Sequence": 4, "StationID": "R22"}, {"Sequence": 5, "StationID": "R22A"}]}]
    data = build(stations=stations, station_of_line=sol)
    r = [p["stops"] for p in by_line(data, "R")]
    assert ["R22", "R22A"] in r and ["R22A", "R22"] in r
    assert all(not ("R22A" in s and "R11" in s) for s in r)
    assert b.check_metro_index(data) == []


def test_stations_not_on_any_pattern_are_dropped():
    stations = STATIONS + [{"StationID": "Y01", "StationName": name("某站", None), "StationPosition": pos(25.0, 121.5)}]
    ids = {s["stationId"] for s in build(stations=stations)["stations"]}
    assert "Y01" not in ids


def test_circular_line_from_second_operator_is_kept_and_light_rail_dropped():
    stations = STATIONS + [
        {"StationID": "Y15", "StationName": name("新埔民生", "Xinpu Minsheng"), "StationPosition": pos(25.0232, 121.4685)},
        {"StationID": "Y16", "StationName": name("板橋", "Banqiao"), "StationPosition": pos(25.0141, 121.4637)},
        {"StationID": "BL07", "StationName": name("板橋", "Banqiao"), "StationPosition": pos(25.0141, 121.4625)},
        {"StationID": "BL08", "StationName": name("新埔", "Xinpu"), "StationPosition": pos(25.0234, 121.4683)},
        {"StationID": "V01", "StationName": name("紅樹林", "Hongshulin"), "StationPosition": pos(25.1546, 121.4593)},
        {"StationID": "V02", "StationName": name("竿蓁林", "Ganzhenlin"), "StationPosition": pos(25.1574, 121.4567)},
    ]
    sol = STATION_OF_LINE + [
        {"LineID": "BL", "Stations": [{"Sequence": 1, "StationID": "BL07"}, {"Sequence": 2, "StationID": "BL08"}]},
        {"LineID": "Y", "Stations": [{"Sequence": 1, "StationID": "Y15"}, {"Sequence": 2, "StationID": "Y16"}]},
        {"LineID": "V", "Stations": [{"Sequence": 1, "StationID": "V01"}, {"Sequence": 2, "StationID": "V02"}]},
    ]
    lines = LINES + [{"LineID": "Y", "LineName": name("環狀線", "Circular Line")},
                     {"LineID": "V", "LineName": name("淡海輕軌", "Danhai LRT")}]
    data = build(stations=stations, station_of_line=sol, lines=lines, transfers=None)
    assert b.check_metro_index(data) == []
    assert {l["lineId"] for l in data["lines"]} == {"BL", "R", "Y"}
    assert {"V01", "V02"}.isdisjoint({s["stationId"] for s in data["stations"]})
    assert {"from": "Y16", "to": "BL07", "walkS": b.DEFAULT_TRANSFER_S} in data["transfers"]
    # 名稱不同的轉乘站（新埔民生 ↔ 新埔）靠 EXTRA_TRANSFERS
    assert {"from": "Y15", "to": "BL08", "walkS": b.DEFAULT_TRANSFER_S} in data["transfers"]
    assert {"from": "BL08", "to": "Y15", "walkS": b.DEFAULT_TRANSFER_S} in data["transfers"]
