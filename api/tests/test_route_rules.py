from datetime import datetime, timezone

import pytest
from app.engine import PedestrianCosting
from app.route_rules import TPE, costing_for, period_of


@pytest.mark.parametrize("hour,minute,expected", [(17,59,"day"),(18,0,"night"),(5,59,"night"),(6,0,"day")])
def test_period(hour, minute, expected):
    assert period_of(datetime(2026,11,7,hour,minute,tzinfo=TPE), None) == expected


def test_utc_and_simulation():
    assert period_of(datetime(2026,11,7,10,tzinfo=timezone.utc), None) == "night"
    assert period_of(datetime(2026,11,7,10,tzinfo=TPE), "night") == "night"


@pytest.mark.parametrize("audience,speed", [("elder",3.5),("child",5.1),("visitor",5.1)])
def test_costing(audience, speed):
    assert costing_for("fastest", audience) == PedestrianCosting(walking_speed_kmh=speed)


from dataclasses import replace
from app.engine import EngineRoute
from app.metrics_stub import Metrics
from app.route_rules import (alternates_for, candidates_for, detour_too_long, diff_of,
                             pick_child, reasons_for, same_route)


def route(distance=100, lat=25.0, points=None):
    return EngineRoute(distance, distance * 2, points or [(lat, 121.5), (lat, 121.501)], [])


def met(steps=None, climb=None, light=None, crossings=None):
    return Metrics(steps, climb, light, crossings, None, None)


@pytest.mark.parametrize("audience,period,expected", [
    ("elder", "day", ["fewer_steps_hills", "fastest"]),
    ("elder", "night", ["fewer_steps_hills_bright", "fastest"]),
    ("child", "day", ["fewer_unsignalized", "fastest"]),
    ("child", "night", ["fewer_unsignalized_bright", "fastest"]),
    ("visitor", "day", ["fastest"]), ("visitor", "night", ["bright", "fastest"]),
])
def test_candidates(audience, period, expected):
    result = candidates_for(audience, period)
    assert result == expected
    result.clear()
    assert candidates_for(audience, period) == expected


def test_weights_and_alternates():
    assert costing_for("fewer_steps_hills_bright", "elder") == replace(PedestrianCosting(), step_penalty=120, elevator_penalty=0, use_hills=.1, use_lit=.8, alley_factor=3, walking_speed_kmh=3.5)
    assert costing_for("fewer_unsignalized", "child") == replace(PedestrianCosting(), sidewalk_factor=.8, walkway_factor=.9, alley_factor=3, driveway_factor=8)
    assert alternates_for("fewer_unsignalized_bright") == 2 and alternates_for("bright") == 0
    with pytest.raises(KeyError):
        costing_for("missing", "visitor")


def test_same_route_geometries():
    a = route()
    assert same_route(a, a)
    assert not same_route(a, route(95))
    assert same_route(a, route(lat=25.00009))
    assert not same_route(a, route(lat=25.0002))
    assert same_route(route(points=[(25, 121.5)]), route(points=[(25, 121.5)]))
    assert not same_route(a, route(points=[(25, 121.5), (25.0003, 121.5005), (25, 121.501)]))


def test_detours():
    assert detour_too_long(route(1301), route(1000))
    assert detour_too_long(route(151), route(100))
    assert not detour_too_long(route(140), route(100))
    assert not detour_too_long(route(300), route(0))
    assert detour_too_long(route(301), route(0))


def test_child_selection():
    rs = [route(150), route(120), route(100)]
    assert pick_child(rs, [met(crossings=2), met(crossings=1), met(crossings=None)]) == 1
    assert pick_child(rs, [met(), met(), met()]) == 0
    assert pick_child(rs, [met(crossings=1), met(crossings=1), met(crossings=2)]) == 1
    assert pick_child(rs[:1], [met()]) == 0


def test_diff_and_reasons():
    fast, cand = met(3, 10, .2, 4), met(2, 8, .3, 2)
    diff = diff_of(route(120), cand, route(100), fast)
    assert diff == {"distanceM": 20, "durationS": 40, "steps": 1, "climbM": 2, "unsignalizedCrossings": 2}
    assert reasons_for("fewer_steps_hills_bright", cand, fast, diff) == ["fewer_steps", "flatter", "brighter", "extra_distance"]
    assert reasons_for("bright", met(1, None, .29), fast, diff) == []
    assert reasons_for("bright", cand, fast, diff) == ["brighter", "extra_distance"]
    assert reasons_for("fewer_steps_hills", met(3), fast, diff) == []
    assert reasons_for("fewer_steps_hills", met(2), fast, {**diff, "distanceM": 19}) == ["fewer_steps"]
    assert reasons_for("fewer_unsignalized_bright", cand, fast, diff) == ["brighter", "fewer_unsignalized_crossings", "extra_distance"]
    assert diff_of(route(), met(), route(), fast)["steps"] is None
