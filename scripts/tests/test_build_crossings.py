from scripts.build_crossings import build, classify


def test_classify():
    assert classify({"crossing": "traffic_signals"}) == "signal"
    assert classify({"crossing": "uncontrolled"}) == "unsignalized"
    assert classify({"crossing": "unmarked"}) == "unsignalized"
    assert classify({"crossing": "zebra"}) == "unknown"
    assert classify({}) == "unknown"


def test_build_groups_nodes_and_rounds_coordinates():
    overpass = {"elements": [
        {"type": "node", "lat": 25.04781234, "lon": 121.51701234, "tags": {"crossing": "traffic_signals"}},
        {"type": "node", "lat": 25.1, "lon": 121.5, "tags": {"crossing": "unmarked"}},
        {"type": "node", "lat": 25.2, "lon": 121.6},
        {"type": "way", "id": 1},
    ]}
    out = build(overpass, "2026-11-07T00:00:00+08:00")
    assert out == {
        "updatedAt": "2026-11-07T00:00:00+08:00",
        "signal": [[25.04781, 121.51701]],
        "unsignalized": [[25.1, 121.5]],
        "unknown": [[25.2, 121.6]],
    }
