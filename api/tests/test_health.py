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
    import importlib
    import app.main as main
    monkeypatch.setenv("APP_VERSION", "test-version")
    try:
        importlib.reload(main)
        assert main.health()["version"] == "test-version"
    finally:
        monkeypatch.delenv("APP_VERSION")
        importlib.reload(main)
