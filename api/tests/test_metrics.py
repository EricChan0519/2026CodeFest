import json

import pytest

from app import metrics
from app.engine import EngineRoute, Maneuver
from app.metrics import Metrics, cell_of, climb_m, measure

# About 111 m north along one meridian.
START, END = (25.0400, 121.5000), (25.0410, 121.5000)


def route(geometry=(START, END), kinds=("depart", "arrive")):
    maneuvers = [Maneuver(k, 0, 0.0, None) for k in kinds]
    return EngineRoute(distance_m=111.0, duration_s=80.0, geometry=list(geometry), maneuvers=maneuvers)


@pytest.fixture
def snapshots(tmp_path, monkeypatch):
    monkeypatch.setattr(metrics, "DATA_DIR", tmp_path)
    metrics._load_crossings.cache_clear()
    metrics._load_lamp_cells.cache_clear()
    metrics._load_safety.cache_clear()
    metrics._load_stores.cache_clear()
    yield tmp_path
    metrics._load_crossings.cache_clear()
    metrics._load_lamp_cells.cache_clear()
    metrics._load_safety.cache_clear()
    metrics._load_stores.cache_clear()


def write_crossings(path, signal=(), unsignalized=(), unknown=()):
    (path / "crossings.json").write_text(json.dumps(
        {"updatedAt": "t", "signal": list(signal), "unsignalized": list(unsignalized), "unknown": list(unknown)}))


def write_lamps(path, cells):
    (path / "lamp_grid.json").write_text(json.dumps({"updatedAt": "t", "cells": list(cells)}))


def test_cell_key_format_matches_snapshot_script():
    assert cell_of(25.04001, 121.50001) == "92740:405000"


def test_missing_snapshots_give_none_not_errors(snapshots):
    assert measure(route(kinds=("depart", "stairs", "arrive"))) == Metrics(1, None, None, None, None, None)


def test_corrupt_snapshot_gives_none(snapshots):
    (snapshots / "crossings.json").write_text("{not json")
    (snapshots / "lamp_grid.json").write_text("[]")
    m = measure(route())
    assert m.signal_crossings is None and m.lit_ratio is None


def test_steps_count_stairs_maneuvers(snapshots):
    assert measure(route(kinds=("depart", "stairs", "straight", "stairs", "arrive"))).steps == 2


def test_crossings_within_8m_are_counted_by_kind(snapshots):
    write_crossings(
        snapshots,
        signal=[[25.0405, 121.50005]],        # about 5 m east of the route
        unsignalized=[[25.0402, 121.50003], [25.0408, 121.49996]],
        unknown=[[25.0405, 121.5001]],        # about 10 m east: outside the buffer
    )
    m = measure(route())
    assert (m.signal_crossings, m.unsignalized_crossings, m.unknown_crossings) == (1, 2, 0)


def test_crossing_beyond_the_route_end_is_not_counted(snapshots):
    write_crossings(snapshots, signal=[[25.0412, 121.5]])     # on the same line, 22 m past the end
    assert measure(route()).signal_crossings == 0


def test_crossing_near_two_segments_counts_once(snapshots):
    corner = (25.0405, 121.5000)
    write_crossings(snapshots, signal=[list(corner)])
    assert measure(route(geometry=(START, corner, (25.0405, 121.5010)))).signal_crossings == 1


def test_crossing_counts_across_index_cell_boundaries(snapshots):
    # A long segment passes many index cells; the crossing sits mid-way.
    write_crossings(snapshots, signal=[[25.0450, 121.5]])
    assert measure(route(geometry=((25.04, 121.5), (25.05, 121.5)))).signal_crossings == 1


def test_lit_ratio_is_share_of_samples_near_a_lamp(snapshots):
    # 111 m route sampled each 20 m: 0, 20, ... 100, plus the end = 7 points.
    # The lamp cell is 30 m tall and neighbours count, so only the 0 m and 20 m samples are near it.
    write_lamps(snapshots, [cell_of(*START)])
    assert measure(route()).lit_ratio == 0.29


def test_lamp_in_a_neighbouring_cell_counts(snapshots):
    write_lamps(snapshots, [cell_of(START[0] - 0.00027, START[1] + 0.0003)])
    assert measure(route(geometry=(START,))).lit_ratio == 1.0


def test_lamp_two_cells_away_does_not_count(snapshots):
    write_lamps(snapshots, [cell_of(START[0] - 0.0006, START[1])])
    assert measure(route(geometry=(START,))).lit_ratio == 0.0


def test_empty_geometry_does_not_crash(snapshots):
    write_crossings(snapshots)
    write_lamps(snapshots, [])
    m = measure(route(geometry=()))
    assert m.lit_ratio is None and m.signal_crossings == 0


def test_climb_sums_only_rises():
    assert climb_m([10, 12, 11, 15]) == 6


def test_climb_none_when_no_data():
    assert climb_m(None) is None


def write_safety(path, cameras=(), police=(), coverage=0.85):
    (path / "safety_points.json").write_text(json.dumps({
        "updatedAt": "2026-11-07T19:00:00+08:00", "police": [list(p) for p in police],
        "cameras": [list(c) for c in cameras], "cameraCoverage": {"coverage": coverage}}))


def test_cameras_within_50m_of_the_route_are_counted(snapshots):
    write_safety(snapshots, cameras=[
        (25.0405, 121.50020),   # about 20 m east
        (25.0402, 121.49955),   # about 42 m west
        (25.0405, 121.50080),   # about 74 m east: outside
        (25.0420, 121.50000),   # 100 m past the end: outside
    ])
    assert measure(route()).cameras == 2


def test_police_offices_within_150m_are_counted_once_per_address(snapshots):
    write_safety(snapshots, police=[
        (25.0405, 121.50100, "近的派出所"),            # about 100 m east
        (25.0405, 121.50100, "同址分局"),              # same address: counts once
        (25.0405, 121.50300, "遠的派出所"),            # about 290 m east
    ])
    assert measure(route()).police_nearby == 1


def test_missing_safety_snapshot_gives_none(snapshots):
    m = measure(route())
    assert m.cameras is None and m.police_nearby is None


def test_low_camera_coverage_hides_cameras_but_keeps_police(snapshots):
    write_safety(snapshots, cameras=[(25.0405, 121.5002)], police=[(25.0405, 121.5010, "派出所")], coverage=0.4)
    m = measure(route())
    assert m.cameras is None and m.police_nearby == 1


def test_corrupt_safety_snapshot_gives_none(snapshots):
    (snapshots / "safety_points.json").write_text('{"cameras": [[1]], "police": []}')
    m = measure(route())
    assert m.cameras is None and m.police_nearby is None


def test_nearby_point_lamps_cameras_and_police(snapshots):
    write_lamps(snapshots, [cell_of(*START)])
    write_safety(snapshots, cameras=[(25.04010, 121.50000), (25.0420, 121.5000)],
                 police=[(25.0405, 121.5010, "派出所"), (25.0400, 121.5009, "更近的派出所")])
    found = metrics.nearby(*START)
    assert found["lamps"] == {"nearby": True, "cells": 1}
    assert found["cameras"] == 1
    assert [p["name"] for p in found["police"]] == ["更近的派出所", "派出所"]
    assert found["police"][0]["distanceM"] == pytest.approx(92, abs=3)


def test_nearby_point_lamp_radius_is_respected(snapshots):
    far = cell_of(START[0] + 0.0006, START[1])      # about 55 m north
    write_lamps(snapshots, [far])
    assert metrics.nearby(*START, radius_m=30)["lamps"] == {"nearby": False, "cells": 0}
    assert metrics.nearby(*START, radius_m=80)["lamps"] == {"nearby": True, "cells": 1}


def test_nearby_point_without_snapshots_is_all_none(snapshots):
    assert metrics.nearby(*START) == {"lamps": None, "cameras": None, "police": None}


def write_stores(path, convenience=(), shops=()):
    (path / "store_points.json").write_text(json.dumps({
        "updatedAt": "2026-11-07T23:00:00+08:00", "convenience": [list(p) for p in convenience],
        "shopCells": sorted({cell_of(*p) for p in shops})}))


def test_convenience_stores_within_40m_and_shop_ratio(snapshots):
    write_stores(snapshots, convenience=[
        (25.0405, 121.50030),   # about 30 m east
        (25.0405, 121.50060),   # about 60 m east: outside
    ], shops=[START])
    m = measure(route())
    assert m.stores == 1
    assert 0 < m.shop_ratio < 1


def test_missing_store_snapshot_gives_none(snapshots):
    m = measure(route())
    assert m.stores is None and m.shop_ratio is None


def test_edge_ratios_by_length():
    from app.engine import EdgeInfo
    edges = [EdgeInfo(0, 1, "alley", "service_other", 30), EdgeInfo(1, 2, "sidewalk", "primary", 50),
             EdgeInfo(2, 3, "pedestrian_crossing", "secondary", 10), EdgeInfo(3, 4, "footway", "service_other", 10)]
    assert metrics.edge_ratios(edges) == (0.3, 0.6)
    assert metrics.edge_ratios(None) == (None, None) and metrics.edge_ratios([]) == (None, None)


def test_anchor_points_lists_police_and_stores_in_box(snapshots):
    write_safety(snapshots, police=[(25.0405, 121.5001, "士林分局")])
    write_stores(snapshots, convenience=[(25.0406, 121.5002), (25.0600, 121.5002)])
    found = metrics.anchor_points(25.04, 25.041, 121.4995, 121.5005)
    assert sorted(k for *_, k in found) == ["police", "store"]
