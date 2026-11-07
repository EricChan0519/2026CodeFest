from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters.fake import FakeEngine
from app import elevation, metrics_stub, routes_service
from app.main import app, get_measure, get_now, get_routing_engine, get_station_index
from app.route_rules import TPE
from app.stations import StationIndex


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def isolate_snapshots(monkeypatch, tmp_path):
    # 測試不讀 repo 裡 B 產生的 lamp_grid.json，也不受部署環境變數影響
    monkeypatch.setenv("ELEVATION_GRID_PATH", str(tmp_path / "no_elevation.json"))
    elevation._load.cache_clear()
    monkeypatch.setenv("LAMP_GRID_PATH", str(tmp_path / "no_lamp_grid.json"))
    monkeypatch.delenv("OSM_UPDATED_AT", raising=False)
    routes_service.lamp_grid_updated_at.cache_clear()
    yield
    routes_service.lamp_grid_updated_at.cache_clear()
    elevation._load.cache_clear()


@pytest.fixture
def station_index():
    return StationIndex.load(Path(__file__).parent / "fixtures" / "stop_index.json")


@pytest.fixture
def fake_engine():
    return FakeEngine()


@pytest.fixture
def no_route(fake_engine):
    fake_engine.mode = "no_route"
    return fake_engine


@pytest.fixture
def down(fake_engine):
    fake_engine.mode = "down"
    return fake_engine


@pytest.fixture
def client(station_index, fake_engine):
    app.dependency_overrides[get_station_index] = lambda: station_index
    app.dependency_overrides[get_routing_engine] = lambda: fake_engine
    app.dependency_overrides[get_now] = lambda: datetime(2026, 11, 7, 10, tzinfo=TPE)
    # 預設用 stub 量測，結果不受 B 的 metrics.py 與快照影響；要量測值的測試自己 override
    app.dependency_overrides[get_measure] = lambda: metrics_stub.measure
    with TestClient(app) as test_client:
        yield test_client
