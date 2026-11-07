def test_health_shape(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert set(body) >= {"status", "version", "stopIndexUpdatedAt"}


def test_validation_error_hides_input(client):
    r = client.post("/api/stations/nearby", json={"lat": 25.123456, "lon": "x", "radiusM": 500})
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "VALIDATION_ERROR"}}
    assert "25.123456" not in r.text

