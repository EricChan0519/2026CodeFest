IDS = {"fastest", "fewer_steps_hills", "fewer_steps_hills_bright", "fewer_unsignalized", "fewer_unsignalized_bright", "bright"}
REASONS = {"fastest", "fewer_steps", "flatter", "brighter", "fewer_unsignalized_crossings", "extra_distance"}
KINDS = {"depart", "straight", "slight_left", "slight_right", "left", "right", "uturn", "stairs", "arrive"}
BEARINGS = {"E", "W", "S", "N", "SE", "NE", "SW", "NW", None}


def check_routes(body):
    context = body["context"]
    assert context["audience"] in {"elder", "child", "visitor"}
    assert context["period"] in {"day", "night"} and isinstance(context["simulated"], bool)
    assert isinstance(body["sources"], list)
    assert set(body["notes"]) <= {"no_better_route", "simulated_night"}
    routes = body["routes"]
    assert routes and routes[0]["recommended"] is True and sum(r["recommended"] for r in routes) == 1
    for r in routes:
        assert {"id", "recommended", "reasons", "distanceM", "durationS", "geometry", "maneuvers", "metrics", "diff"} <= r.keys()
        assert r["id"] in IDS and set(r["reasons"]) <= REASONS
        geometry = r["geometry"]
        assert geometry and all(len(p) == 2 and 24.96 <= p[0] <= 25.21 and 121.45 <= p[1] <= 121.67 for p in geometry)
        maneuvers = r["maneuvers"]
        assert maneuvers and maneuvers[0]["kind"] == "depart" and maneuvers[-1]["kind"] == "arrive"
        assert maneuvers[-1]["atIndex"] == len(geometry) - 1
        assert all(m["kind"] in KINDS and 0 <= m["atIndex"] < len(geometry) for m in maneuvers)
        assert [m["atIndex"] for m in maneuvers] == sorted(m["atIndex"] for m in maneuvers)
        if r["metrics"] is not None:
            assert {"steps", "climbM", "litRatio", "unsignalizedCrossings", "signalCrossings", "unknownCrossings"} <= r["metrics"].keys()
        if r["diff"] is not None:
            assert {"distanceM", "durationS", "steps", "climbM", "unsignalizedCrossings"} <= r["diff"].keys()
        if r["id"] == "fastest":
            assert r["diff"] is None


def check_stations(body, nearby):
    assert {"name", "updatedAt"} <= body["source"].keys()
    assert body["stations"]
    for s in body["stations"]:
        assert {"stationUid", "name", "bearing", "lat", "lon", "routes"} <= s.keys()
        assert s["stationUid"] and s["name"]["zh"] and {"zh", "en"} <= s["name"].keys()
        assert s["bearing"] in BEARINGS and 24.96 <= s["lat"] <= 25.21 and 121.45 <= s["lon"] <= 121.67
        assert ("distanceM" in s) == nearby
        for route in s["routes"]:
            assert {"routeName", "direction", "headsign", "stopUid"} <= route.keys()
            assert {"zh", "en"} <= route["routeName"].keys() and {"zh", "en"} <= route["headsign"].keys()
            assert route["direction"] in {0, 1, 2, 10, 255}
    if nearby:
        distances = [s["distanceM"] for s in body["stations"]]
        assert distances == sorted(distances)

