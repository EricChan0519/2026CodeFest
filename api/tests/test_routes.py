import logging
from datetime import datetime

import pytest
from app.main import app, get_now
from app.route_rules import TPE
from contract_checks import check_routes

REQUEST = {"from": {"lat":25.123456,"lon":121.512345}, "to":{"lat":25.124,"lon":121.513}, "audience":"visitor"}


def test_route_shape(client, fake_engine):
    response = client.post("/api/routes", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    check_routes(body)
    assert body["context"] == {"audience":"visitor", "period":"day", "simulated":False}
    assert body["notes"] == [] and len(body["routes"]) == 1
    route = body["routes"][0]
    assert (route["id"], route["recommended"], route["reasons"], route["metrics"], route["diff"]) == ("fastest", True, ["fastest"], {"steps": None, "climbM": None, "litRatio": None, "unsignalizedCrossings": None, "signalCrossings": None, "unknownCrossings": None}, None)
    assert route["geometry"][0] == [25.123456,121.512345]
    assert "shape" not in response.text and "polyline" not in response.text
    assert fake_engine.last["costing"].walking_speed_kmh == 5.1 and fake_engine.last["alternates"] == 0


def test_variations(client, fake_engine):
    body = client.post("/api/routes", json={**REQUEST,"audience":"elder", "candidate":"fewer_steps_hills", "simulate":"night"}).json()
    assert fake_engine.last["costing"].walking_speed_kmh == 3.5
    assert body["routes"][0]["id"] == "fewer_steps_hills" and body["context"]["simulated"] and body["context"]["period"] == "night" and body["notes"] == ["simulated_night"]
    app.dependency_overrides[get_now] = lambda: datetime(2026,11,7,20,tzinfo=TPE)
    body = client.post("/api/routes", json=REQUEST).json()
    assert body["context"]["period"] == "night" and not body["context"]["simulated"] and body["notes"] == ["no_better_route"]
    assert client.post("/api/routes", json={**REQUEST,"candidate":"nope"}).status_code == 422
    body = client.post("/api/routes", json={**REQUEST,"to":REQUEST["from"]}).json()
    assert len(body["routes"][0]["geometry"]) == 1


@pytest.mark.parametrize("field", ["from", "to"])
def test_out_of_area(client, field):
    r = client.post("/api/routes", json={**REQUEST,field:{"lat":24,"lon":121.5}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "OUT_OF_AREA"


def test_failures_and_privacy(client, fake_engine, caplog):
    caplog.set_level(logging.DEBUG)
    assert client.post("/api/routes", json=REQUEST).status_code == 200
    fake_engine.mode = "no_route"
    r = client.post("/api/routes", json=REQUEST)
    assert r.status_code == 404 and r.json()["error"]["code"] == "ROUTE_NOT_FOUND"
    fake_engine.mode = "down"
    r = client.post("/api/routes", json=REQUEST)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ROUTING_UNAVAILABLE"
    async def broken(*args, **kwargs):
        raise RuntimeError("25.123456")
    fake_engine.route = broken
    assert client.post("/api/routes", json=REQUEST).status_code == 503
    r = client.post("/api/routes", json={**REQUEST,"audience":"bad"})
    assert r.status_code == 422 and "25.123456" not in r.text
    assert "25.123456" not in caplog.text and "121.512345" not in caplog.text


def test_empty_result(client, fake_engine):
    async def empty(*args, **kwargs):
        return []
    fake_engine.route = empty
    assert client.post("/api/routes", json=REQUEST).status_code == 404


from app.engine import EngineRoute, Maneuver, RouteNotFound, RoutingUnavailable
from app.main import get_measure, get_routing_engine
from app import metrics_stub, routes_service
from app.metrics_stub import Metrics
from app.route_rules import costing_for


def make_route(distance, lat=25.123456):
    return EngineRoute(distance, distance * 2, [(lat, 121.512345), (lat, 121.512645)],
                       [Maneuver("depart", 0, 30, None), Maneuver("arrive", 1, 0, None)])


class ScriptedEngine:
    def __init__(self, audience, candidate, fast, alternatives):
        self.fast_cost = costing_for("fastest", audience)
        self.candidate_cost = costing_for(candidate, audience)
        self.fast, self.alternatives, self.calls = fast, alternatives, []

    async def route(self, origin, dest, costing, alternates=0):
        self.calls.append((costing, alternates))
        result = self.fast if costing == self.fast_cost else self.alternatives
        assert costing in (self.fast_cost, self.candidate_cost)
        if isinstance(result, Exception):
            raise result
        return result


def install(engine, values=None):
    app.dependency_overrides[get_routing_engine] = lambda: engine
    if values is not None:
        def measure(route):
            value = values[id(route)]
            if isinstance(value, Exception):
                raise value
            return value
        app.dependency_overrides[get_measure] = lambda: measure


def metrics(steps=None, climb=None, light=None, crossings=None):
    return Metrics(steps, climb, light, crossings, None, None)


def post_checked(client, **fields):
    response = client.post("/api/routes", json={**REQUEST, **fields})
    assert response.status_code == 200
    body = response.json()
    check_routes(body)
    return body


def test_elder_night_and_detour(client):
    fast, cand = make_route(100), make_route(130, 25.1238)
    engine = ScriptedEngine("elder", "fewer_steps_hills_bright", [fast], [cand])
    install(engine, {id(fast): metrics(3, 10, .2), id(cand): metrics(2, 7, .4)})
    body = post_checked(client, audience="elder", simulate="night")
    assert [r["id"] for r in body["routes"]] == ["fewer_steps_hills_bright", "fastest"]
    assert body["routes"][0]["reasons"] == ["fewer_steps", "flatter", "brighter", "extra_distance"]
    assert body["routes"][0]["diff"] == {"distanceM": 30, "durationS": 60, "steps": 1, "climbM": 3, "unsignalizedCrossings": None}
    long = make_route(450, 25.1238)
    engine.alternatives = [long]
    install(engine, {id(fast): metrics(3), id(long): metrics(1)})
    body = post_checked(client, audience="elder", simulate="night")
    assert [r["id"] for r in body["routes"]] == ["fastest", "fewer_steps_hills_bright"]
    assert body["notes"] == ["simulated_night"]


def test_same_no_improvement_and_default_stub(client):
    fast, cand = make_route(100), make_route(100, 25.1238)
    engine = ScriptedEngine("elder", "fewer_steps_hills_bright", [fast], [fast])
    install(engine, {id(fast): metrics(1)})
    assert post_checked(client, audience="elder", simulate="night")["notes"] == ["no_better_route", "simulated_night"]
    engine.alternatives = [cand]
    install(engine, {id(fast): metrics(1), id(cand): metrics(1)})
    assert len(post_checked(client, audience="elder", simulate="night")["routes"]) == 1
    app.dependency_overrides[get_measure] = lambda: metrics_stub.measure  # 沒有量測資料
    body = post_checked(client, audience="elder", simulate="night")
    assert all(v is None for v in body["routes"][0]["metrics"].values())
    assert body["notes"] == ["no_better_route", "simulated_night"]


@pytest.mark.parametrize("count", [1, 3])
def test_child_alternatives(client, count):
    fast = make_route(100)
    options = [make_route(130 + i * 10, 25.1238 + i * .0003) for i in range(count)]
    engine = ScriptedEngine("child", "fewer_unsignalized", [fast], options)
    values = {id(fast): metrics(crossings=5)}
    values.update({id(r): metrics(crossings=3-i) for i, r in enumerate(options)})
    install(engine, values)
    body = post_checked(client, audience="child")
    assert body["routes"][0]["distanceM"] == options[-1].distance_m
    assert (engine.candidate_cost, 2) in engine.calls


def test_failures_simulation_and_privacy(client, caplog):
    caplog.set_level(logging.ERROR)
    fast, cand = make_route(100), make_route(120, 25.1238)
    engine = ScriptedEngine("visitor", "bright", [fast], RoutingUnavailable("25.123456"))
    install(engine, {id(fast): RuntimeError("121.512345")})
    body = post_checked(client, simulate="night")
    assert body["notes"] == ["no_better_route", "simulated_night"]
    assert all(v is None for v in body["routes"][0]["metrics"].values())
    engine.fast = RouteNotFound("25.123456")
    assert client.post("/api/routes", json={**REQUEST, "simulate":"night"}).status_code == 404
    assert "25.123456" not in caplog.text and "121.512345" not in caplog.text
    engine.fast, engine.alternatives = [fast], [cand]
    install(engine, {id(fast): metrics(light=.2), id(cand): metrics(light=.4)})
    body = post_checked(client, simulate="night")
    assert body["routes"][0]["id"] == "bright" and body["notes"] == ["simulated_night"]


def test_replan_one_call(client):
    cand = make_route(120)
    engine = ScriptedEngine("visitor", "bright", [], [cand])
    install(engine, {id(cand): metrics(light=.4)})
    body = post_checked(client, candidate="bright")
    assert len(engine.calls) == 1
    assert body["routes"][0]["id"] == "bright" and body["routes"][0]["reasons"] == [] and body["routes"][0]["diff"] is None


def test_same_geometry_with_improvement_and_empty_candidate(client):
    fast, cand = make_route(100), make_route(101)
    engine = ScriptedEngine("elder", "fewer_steps_hills", [fast], [cand])
    install(engine, {id(fast): metrics(3), id(cand): metrics(1)})
    body = post_checked(client, audience="elder")
    assert len(body["routes"]) == 1 and body["notes"] == ["no_better_route"]
    engine.alternatives = []
    body = post_checked(client, audience="elder")
    assert len(body["routes"]) == 1 and body["notes"] == ["no_better_route"]


def test_sources_without_lamp_grid(client):
    assert client.post("/api/routes", json=REQUEST).json()["sources"] == [{"name": "OpenStreetMap", "updatedAt": None}]


def test_sources_with_osm_date_and_lamp_grid(client, monkeypatch, tmp_path):
    grid = tmp_path / "lamp_grid.json"
    grid.write_text('{"updatedAt": "2026-11-07", "cells": []}', encoding="utf-8")
    monkeypatch.setenv("LAMP_GRID_PATH", str(grid))
    monkeypatch.setenv("OSM_UPDATED_AT", "2026-11-06")
    routes_service.lamp_grid_updated_at.cache_clear()
    assert client.post("/api/routes", json=REQUEST).json()["sources"] == [
        {"name": "OpenStreetMap", "updatedAt": "2026-11-06"},
        {"name": "臺北市路燈位置分布圖", "updatedAt": "2026-11-07"}]


def test_broken_lamp_grid_is_omitted(client, monkeypatch, tmp_path):
    grid = tmp_path / "lamp_grid.json"
    grid.write_text("not json", encoding="utf-8")
    monkeypatch.setenv("LAMP_GRID_PATH", str(grid))
    routes_service.lamp_grid_updated_at.cache_clear()
    assert [s["name"] for s in client.post("/api/routes", json=REQUEST).json()["sources"]] == ["OpenStreetMap"]
