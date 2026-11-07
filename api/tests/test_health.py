def test_health_shape(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert set(body) >= {"status", "version", "stopIndexUpdatedAt"}


def test_validation_error_hides_input(client):
    r = client.post("/api/stations/nearby", json={"lat": 25.123456, "lon": "x", "radiusM": 500})
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "VALIDATION_ERROR"}}
    assert "25.123456" not in r.text



def test_version_reads_environment(monkeypatch):
    import subprocess
    import sys
    monkeypatch.setenv("APP_VERSION", "test-version")
    output = subprocess.check_output([sys.executable, "-c", "from app.main import VERSION; print(VERSION)"], text=True)
    assert output.strip() == "test-version"


def test_deep(client, fake_engine, station_index):
    response = client.get("/api/health?deep=1")
    assert response.status_code == 200 and response.json()["checks"] == {"routing": True, "stopIndex": True}
    fake_engine.mode = "down"
    response = client.get("/api/health?deep=1")
    assert response.status_code == 503 and response.json()["checks"]["routing"] is False
    fake_engine.mode = "ok"
    station_index.available = False
    station_index.updated_at = None
    response = client.get("/api/health?deep=1")
    assert response.status_code == 503 and response.json()["checks"]["stopIndex"] is False
    assert response.json()["stopIndexUpdatedAt"] is None


def test_shallow_does_not_ping(client, fake_engine):
    async def fail():
        raise AssertionError("不應呼叫 ping")
    fake_engine.ping = fail
    assert client.get("/api/health").status_code == 200
