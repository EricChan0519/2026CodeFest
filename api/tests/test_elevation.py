import json
import struct

import pytest

from app import elevation, metrics


def test_grid_interpolation_and_bad_files(tmp_path, monkeypatch):
    path = tmp_path / 'grid.json'
    monkeypatch.setenv('ELEVATION_GRID_PATH', str(path))
    meta = {'lat0': 25, 'lon0': 121, 'step': 0.01, 'rows': 2, 'cols': 2, 'scale': 0.1, 'nodata': -32768, 'updatedAt': 'today', 'source': {'name': 'test'}}
    path.write_text(json.dumps(meta), encoding='utf8')
    path.with_suffix('.bin').write_bytes(struct.pack('<4h', 10, 20, 30, 40))
    elevation._load.cache_clear()
    assert elevation.available()
    assert elevation.height(25.005, 121.005) == pytest.approx(2.5)
    assert elevation.height(26, 121) is None
    assert elevation.updated_at() == 'today'
    assert elevation.source() == {'name': 'test'}
    path.with_suffix('.bin').write_bytes(struct.pack('<4h', 10, 20, 30, -32768))
    elevation._load.cache_clear()
    assert elevation.height(25.005, 121.005) is None
    path.with_suffix('.bin').write_bytes(b'x')
    elevation._load.cache_clear()
    assert not elevation.available()
    assert elevation.height(25, 121) is None


def test_climb_and_grade():
    assert metrics.climb_m([10, 10.5, 11, 10.2, 11, 11.3, 9, 11]) == 4.1
    assert metrics.max_grade_pct([10, 11, 14], 40) == 10
    assert metrics.max_grade_pct([10, 8], 10) == 20
    assert metrics.max_grade_pct([10, 10], 0) is None


def test_measure_missing_and_present(monkeypatch):
    from app.engine import EngineRoute
    route = EngineRoute(distance_m=40, duration_s=30, geometry=[(25, 121), (25.00036, 121)], maneuvers=[])
    monkeypatch.setattr(metrics.elevation, 'height', lambda lat, lon: None)
    result = metrics.measure(route)
    assert result.climb_m is None and result.max_grade_pct is None
    monkeypatch.setattr(metrics.elevation, 'height', lambda lat, lon: (lat - 25) * 10000)
    result = metrics.measure(route)
    assert result.climb_m > 0 and result.max_grade_pct > 0


def test_slope_diff_and_reason():
    from dataclasses import replace
    from app.route_rules import diff_of, reasons_for
    from app.engine import EngineRoute
    from app.routes_service import metrics_to_dict
    route = EngineRoute(distance_m=100, duration_s=60, geometry=[], maneuvers=[])
    base = metrics.Metrics(0, 0, None, None, None, None)
    fast, cand = replace(base, max_grade_pct=8), replace(base, max_grade_pct=5.9)
    diff = diff_of(route, cand, route, fast)
    assert diff['maxGradePct'] == 2.1
    assert reasons_for('fewer_steps_hills', cand, fast, diff) == ['gentler_slope']
    assert reasons_for('bright', cand, fast, diff) == []
    assert metrics_to_dict(cand)['maxGradePct'] == 5.9


def test_sources_and_health_when_elevation_available(client, monkeypatch):
    from app import routes_service
    monkeypatch.setattr(elevation, 'available', lambda: True)
    monkeypatch.setattr(elevation, 'updated_at', lambda: 'today')
    assert {'name': '內政部20公尺網格數值地形模型', 'updatedAt': 'today'} in routes_service.route_sources()
    response = client.get('/api/health?deep=true')
    assert response.status_code == 200 and response.json()['checks']['elevation'] is True
