from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_station_index
from app.stations import StationIndex

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def station_index():
    return StationIndex.load(FIXTURES / "stop_index.json")


@pytest.fixture
def client(station_index):
    app.dependency_overrides[get_station_index] = lambda: station_index
    yield TestClient(app)
    app.dependency_overrides.clear()
