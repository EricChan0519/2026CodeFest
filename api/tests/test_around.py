import json

import pytest

from app import metrics

HERE = (25.0400, 121.5000)


@pytest.fixture
def data(isolate_metrics_data):
    (isolate_metrics_data / "lamp_grid.json").write_text(
        json.dumps({"updatedAt": "2026-11-07T16:03:38+08:00", "cells": [metrics.cell_of(*HERE)]}))
    (isolate_metrics_data / "safety_points.json").write_text(json.dumps({
        "updatedAt": "2026-11-07T19:14:00+08:00",
        "police": [[25.0405, 121.5010, "範例派出所"]],
        "cameras": [[25.0401, 121.5000], [25.0500, 121.5000]],
        "cameraCoverage": {"coverage": 0.85}}))
    for loader in (metrics._load_lamp_cells, metrics._load_safety):
        loader.cache_clear()
    return isolate_metrics_data


def post(client, **body):
    return client.post("/api/around", json={"lat": HERE[0], "lon": HERE[1], **body})


def test_around_returns_lamps_cameras_police_and_sources(client, data):
    r = post(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["radiusM"] == 50 and body["policeRadiusM"] == 150
    assert body["lamps"] == {"nearby": True, "cells": 1}
    assert body["cameras"] == 1
    assert [p["name"] for p in body["police"]] == ["範例派出所"]
    assert [s["name"] for s in body["sources"]] == [
        "臺北市路燈位置分布圖", "臺北市政府警察局錄影監視系統設置區位",
        "臺北市政府警察局名稱及地址", "Overture Maps（門牌座標）"]
    assert "lat" not in body and "lon" not in body  # the location is not echoed back


def test_around_radius_is_adjustable(client, data):
    assert post(client, radiusM=5).json()["cameras"] == 0           # the camera is about 11 m away
    assert post(client, radiusM=20).json()["cameras"] == 1
    assert post(client, policeRadiusM=50).json()["police"] == []


def test_around_without_snapshots_gives_null_not_an_error(client):
    body = post(client).json()
    assert (body["lamps"], body["cameras"], body["police"], body["sources"]) == (None, None, None, [])


def test_around_outside_the_service_area(client, data):
    r = client.post("/api/around", json={"lat": 24.0, "lon": 120.0})
    assert r.status_code == 400 and r.json() == {"error": {"code": "OUT_OF_AREA"}}


@pytest.mark.parametrize("body", [{"radiusM": 0}, {"radiusM": 301}, {"policeRadiusM": 5}, {"lat": "x"}])
def test_around_validates_input_without_echoing_it(client, data, body):
    r = post(client, **body)
    assert r.status_code == 422 and r.json() == {"error": {"code": "VALIDATION_ERROR"}}


def test_around_is_post_only_so_the_location_stays_out_of_urls(client):
    assert client.get("/api/around?lat=25.04&lon=121.5").status_code == 405


def test_routes_response_lists_safety_sources_when_snapshot_exists(client, data):
    from test_routes import REQUEST
    names = [s["name"] for s in client.post("/api/routes", json=REQUEST).json()["sources"]]
    assert "臺北市政府警察局錄影監視系統設置區位" in names and "Overture Maps（門牌座標）" in names
