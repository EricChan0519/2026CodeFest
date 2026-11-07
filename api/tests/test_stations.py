import logging

from app.main import app, get_station_index


def post_nearby(client, lat, lon, radius_m):
    r = client.post("/api/stations/nearby", json={"lat": lat, "lon": lon, "radiusM": radius_m})
    assert r.status_code == 200, r.text
    return r.json()


def search(client, q):
    r = client.get("/api/stations/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()


def ids(body):
    return [s["stationUid"] for s in body["stations"]]


def test_nearby_sorted_with_distance(client):
    s = post_nearby(client, 25.1, 121.5, 500)["stations"]
    assert ids({"stations": s}) == ["TPE1001", "TPE1002", "TPE1003"]
    assert s[0]["distanceM"] <= s[1]["distanceM"] <= s[2]["distanceM"]
    assert s[0]["distanceM"] == 0 and isinstance(s[1]["distanceM"], int)


def test_nearby_respects_radius(client):
    assert ids(post_nearby(client, 25.1, 121.5, 100)) == ["TPE1001", "TPE1002"]


def test_nearby_has_source(client):
    assert post_nearby(client, 25.1, 121.5, 500)["source"] == {
        "name": "TDX 公車站位資料", "updatedAt": "2026-11-07T15:00:00+08:00"}


def test_nearby_out_of_area(client):
    r = client.post("/api/stations/nearby", json={"lat": 24.0, "lon": 120.0, "radiusM": 500})
    assert r.status_code == 400 and r.json() == {"error": {"code": "OUT_OF_AREA"}}


def test_nearby_radius_limit(client):
    for bad in (0, 5000):
        r = client.post("/api/stations/nearby", json={"lat": 25.1, "lon": 121.5, "radiusM": bad})
        assert r.status_code == 422


def test_search_zh_en_case_insensitive(client):
    assert ids(search(client, "example")) == ids(search(client, "範例")) == ["TPE1001", "TPE1002"]
    assert ids(search(client, "EXAMPLE")) == ["TPE1001", "TPE1002"]


def test_search_handles_null_english(client):
    assert ids(search(client, "其他")) == ["TPE1003"]


def test_search_empty_is_422(client):
    for q in ("", "   "):
        r = client.get("/api/stations/search", params={"q": q})
        assert r.status_code == 422 and r.json() == {"error": {"code": "VALIDATION_ERROR"}}


def test_search_has_no_distance(client):
    assert all("distanceM" not in s for s in search(client, "範例")["stations"])


def test_coords_not_logged(client, caplog):
    caplog.set_level(logging.DEBUG)
    post_nearby(client, 25.123456, 121.5, 500)
    assert "25.123456" not in caplog.text


def test_health_uses_snapshot_time(client):
    assert client.get("/api/health").json()["stopIndexUpdatedAt"] == "2026-11-07T15:00:00+08:00"


def test_missing_snapshot_is_503(client, monkeypatch, tmp_path):
    monkeypatch.setenv("STOP_INDEX_PATH", str(tmp_path / "missing.json"))
    get_station_index.cache_clear()
    app.dependency_overrides.clear()
    r = client.post("/api/stations/nearby", json={"lat": 25.1, "lon": 121.5, "radiusM": 500})
    get_station_index.cache_clear()
    assert r.status_code == 503 and r.json() == {"error": {"code": "DATA_UNAVAILABLE"}}
    assert client.get("/api/health").json()["stopIndexUpdatedAt"] is None
