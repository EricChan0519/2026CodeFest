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
    yield tmp_path
    metrics._load_crossings.cache_clear()
    metrics._load_lamp_cells.cache_clear()


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
