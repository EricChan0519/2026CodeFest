import asyncio
from dataclasses import asdict
import pytest
from app.adapters.fake import FakeEngine
from app.engine import PedestrianCosting, RouteNotFound, RoutingUnavailable, get_engine
from app.geo import haversine_m


def run(coro):
    return asyncio.run(coro)


def test_costing_defaults():
    assert asdict(PedestrianCosting()) == {"walkway_factor": 1.0, "sidewalk_factor": 1.0, "alley_factor": 2.0, "driveway_factor": 5.0, "use_hills": 0.5, "use_lit": 0.0, "step_penalty": None, "elevator_penalty": None, "walking_speed_kmh": 5.1}


@pytest.mark.parametrize("value", [None, "fake", " FAKE "])
def test_factory_fake(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("ROUTING_ENGINE", raising=False)
    else:
        monkeypatch.setenv("ROUTING_ENGINE", value)
    assert isinstance(get_engine(), FakeEngine)


def test_factory_invalid(monkeypatch):
    monkeypatch.setenv("ROUTING_ENGINE", "nope")
    with pytest.raises(ValueError, match="ROUTING_ENGINE.*fake.*valhalla.*osrm"):
        get_engine()


@pytest.mark.parametrize("value", ["valhalla", "osrm"])
def test_factory_lazy_missing_adapters(monkeypatch, value):
    monkeypatch.setenv("ROUTING_ENGINE", value)
    with pytest.raises(ModuleNotFoundError, match=value):
        get_engine()


def test_fake_geometry_maneuvers_and_calls():
    engine = FakeEngine()
    origin, dest = (25.04, 121.51), (25.042, 121.513)
    costing = PedestrianCosting()
    assert engine.last is None
    routes = run(engine.route(origin, dest, costing, alternates=2))
    assert engine.last == {"origin": origin, "dest": dest, "costing": costing, "alternates": 2}
    assert len(engine.calls) == 1 and len(routes) == 3
    assert len({round(r.distance_m, 2) for r in routes}) > 1
    for route in routes:
        assert route.geometry[0] == origin and route.geometry[-1] == dest
        segments = [haversine_m(a, b) for a, b in zip(route.geometry, route.geometry[1:])]
        assert max(segments) <= 25 and abs(sum(segments) - route.distance_m) < 1
        assert route.maneuvers[0].kind == "depart" and route.maneuvers[-1].kind == "arrive"
        assert route.maneuvers[-1].at_index == len(route.geometry) - 1
        indices = [m.at_index for m in route.maneuvers]
        assert indices == sorted(set(indices)) and all(0 <= i < len(route.geometry) for i in indices)
        for i, m in enumerate(route.maneuvers[:-1]):
            assert abs(m.distance_to_next_m - sum(segments[m.at_index:route.maneuvers[i+1].at_index])) < 0.01
        assert route.maneuvers[-1].distance_to_next_m == 0
    slow = run(engine.route(origin, dest, PedestrianCosting(walking_speed_kmh=3.5)))[0]
    assert slow.duration_s > routes[0].duration_s and run(engine.ping()) is True


@pytest.mark.parametrize("mode,exception,ping", [("no_route", RouteNotFound, True), ("down", RoutingUnavailable, False)])
def test_fake_failures(mode, exception, ping):
    engine = FakeEngine(mode)
    with pytest.raises(exception):
        run(engine.route((25, 121), (25.1, 121.1), PedestrianCosting()))
    assert len(engine.calls) == 1 and run(engine.ping()) is ping


@pytest.mark.parametrize("dest", [(25.0, 121.0), (25.000001, 121.0)])
def test_near_identical_points(dest):
    routes = run(FakeEngine().route((25.0, 121.0), dest, PedestrianCosting(), 2))
    for route in routes:
        assert route.geometry == [(25.0, 121.0)] and route.distance_m == route.duration_s == 0
        assert [(m.kind, m.at_index) for m in route.maneuvers] == [("depart", 0), ("arrive", 0)]


@pytest.mark.parametrize("dest", [(25.0, 121.001), (25.001, 121.0)])
def test_axis_aligned_route(dest):
    route = run(FakeEngine().route((25.0, 121.0), dest, PedestrianCosting()))[0]
    assert [m.kind for m in route.maneuvers] == ["depart", "arrive"]
    assert abs(route.maneuvers[0].distance_to_next_m - route.distance_m) < 0.01
