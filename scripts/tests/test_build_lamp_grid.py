from scripts.build_lamp_grid import build, cell_of, twd97_to_wgs84


def test_twd97_taipei():
    lat, lon = twd97_to_wgs84(306800, 2769900)
    assert 25.0 < lat < 25.06 and 121.54 < lon < 121.58


def test_same_cell_for_nearby_points():
    assert cell_of(25.04001, 121.50001) == cell_of(25.04002, 121.50002)
    assert cell_of(25.04001, 121.50001) != cell_of(25.0404, 121.50001)
    assert cell_of(25.04001, 121.50001) != cell_of(25.04001, 121.5005)


def test_skips_invalid_rows():
    rows = [
        {"TWD97X": "306800", "TWD97Y": "2769900"},
        {"TWD97X": "306800.5", "TWD97Y": "2769900.5"},
        {"TWD97X": "", "TWD97Y": "2769900"},
        {"TWD97Y": "2769900"},
        {"TWD97X": "abc", "TWD97Y": "2769900"},
        {"TWD97X": "nan", "TWD97Y": "2769900"},
        {"TWD97X": 0, "TWD97Y": 0},
    ]
    out, used = build(rows, "t")
    assert used == 2
    assert out["updatedAt"] == "t"
    assert out["cells"] == sorted(set(out["cells"])) and len(out["cells"]) == 1


def test_cell_key_format_matches_api_metrics():
    assert cell_of(25.04001, 121.50001) == "92740:405000"
