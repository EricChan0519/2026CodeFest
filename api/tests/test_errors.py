import logging
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.errors import ApiError, install_error_handlers


def test_validation_hides_coordinates(client, caplog):
    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/stations/nearby", json={"lat": 25.123456, "lon": "x"})
    assert response.status_code == 422
    assert response.json() == {"error": {"code": "VALIDATION_ERROR"}}
    assert "25.123456" not in response.text and "25.123456" not in caplog.text


@pytest.mark.parametrize("radius,status", [(0, 422), (2001, 422), (1, 200), (2000, 200)])
def test_radius_bounds(client, radius, status):
    response = client.post("/api/stations/nearby", json={"lat": 25.1, "lon": 121.5, "radiusM": radius})
    assert response.status_code == status
    if status == 200:
        assert response.json() == {"stations": [], "source": None}


def test_api_error_format():
    app = FastAPI()
    install_error_handlers(app)
    @app.get("/")
    def fail():
        raise ApiError("OUT_OF_AREA", 400)
    response = TestClient(app).get("/")
    assert response.status_code == 400
    assert response.json() == {"error": {"code": "OUT_OF_AREA"}}
