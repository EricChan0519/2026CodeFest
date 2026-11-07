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
    assert (route["id"], route["recommended"], route["reasons"], route["metrics"], route["diff"]) == ("fastest", True, ["fastest"], None, None)
    assert route["geometry"][0] == [25.123456,121.512345]
    assert "shape" not in response.text and "polyline" not in response.text
    assert fake_engine.last["costing"].walking_speed_kmh == 5.1 and fake_engine.last["alternates"] == 0


def test_variations(client, fake_engine):
    body = client.post("/api/routes", json={**REQUEST,"audience":"elder", "candidate":"fewer_steps_hills", "simulate":"night"}).json()
    assert fake_engine.last["costing"].walking_speed_kmh == 3.5
    assert body["routes"][0]["id"] == "fastest" and body["context"]["simulated"] and body["context"]["period"] == "night" and body["notes"] == ["simulated_night"]
    app.dependency_overrides[get_now] = lambda: datetime(2026,11,7,20,tzinfo=TPE)
    body = client.post("/api/routes", json=REQUEST).json()
    assert body["context"]["period"] == "night" and not body["context"]["simulated"] and body["notes"] == []
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
