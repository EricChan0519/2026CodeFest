from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters.fake import FakeEngine
from app.main import app, get_now, get_routing_engine, get_station_index
from app.route_rules import TPE
from app.stations import StationIndex


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


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
    with TestClient(app) as test_client:
        yield test_client
