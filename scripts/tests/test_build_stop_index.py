import json
from pathlib import Path

import pytest

from build_stop_index import build_index

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def index():
    load = lambda n: json.loads((FIX / f"tdx_{n}.json").read_text(encoding="utf-8"))
    return build_index(load("stop_of_route"), load("stops"), load("routes"), "2026-11-07T15:00:00+08:00")


def station(index, uid):
    return next(s for s in index["stations"] if s["stationUid"] == uid)


def test_updated_at(index):
    assert index["updatedAt"] == "2026-11-07T15:00:00+08:00"


def test_groups_same_name_different_station_apart(index):
    same = [s for s in index["stations"] if s["name"]["zh"] == "範例站"]
    assert {s["stationUid"] for s in same} == {"TPE1001", "TPE1002"}


def test_station_fields(index):
    st = station(index, "TPE1001")
    assert st["name"] == {"zh": "範例站", "en": "Example Stop"}
    assert st["bearing"] == "E" and st["lat"] == 25.1 and st["lon"] == 121.5
    assert "distanceM" not in st


def test_excludes_alight_only(index):
    # StopBoarding == -1 的路線不進 routes；沒有可上車路線的站位不列
    assert all(s["stationUid"] != "TPE1003" for s in index["stations"])


def test_keeps_boarding_and_both(index):
    assert [r["stopUid"] for r in station(index, "TPE1001")["routes"]] == ["TPE5001", "TPE5011"]
    assert [r["stopUid"] for r in station(index, "TPE1002")["routes"]] == ["TPE5002"]


def test_headsign_from_route_direction(index):
    go, back = station(index, "TPE1001")["routes"]
    assert go["direction"] == 0 and go["headsign"] == {"zh": "往範例終點", "en": "To Example Terminal"}
    assert back["direction"] == 1 and back["headsign"] == {"zh": "往範例起點", "en": "To Example Origin"}
    assert go["routeName"] == {"zh": "307", "en": "307"}


def test_unknown_direction_headsign_is_null(index):
    (r,) = station(index, "TPE1004")["routes"]
    assert r["direction"] == 255 and r["headsign"] == {"zh": None, "en": None}


def test_missing_english_and_bearing_are_null(index):
    st = station(index, "TPE1004")
    assert st["name"]["en"] is None and st["bearing"] is None
    assert st["routes"][0]["routeName"] == {"zh": "小18", "en": None}
