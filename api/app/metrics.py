"""Measure a route against snapshots: stairs, crossing types and street lamp density.

lit_ratio is lamp density, not measured brightness. Missing snapshots give None, never an error.
"""
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.engine import EngineRoute, LatLon
from app import elevation

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

CROSSING_BUFFER_M = 8.0
LIT_SAMPLE_EVERY_M = 20.0
# Same grid as scripts/build_lamp_grid.py.
LAMP_CELL_LAT = 0.00027
LAMP_CELL_LON = 0.0003
_INDEX_CELL_DEG = 0.001
_M_PER_DEG_LAT = 111_195.0
_KINDS = ("signal", "unsignalized", "unknown")


@dataclass(frozen=True)
class Metrics:
    steps: int | None
    climb_m: float | None
    lit_ratio: float | None
    unsignalized_crossings: int | None
    signal_crossings: int | None
    unknown_crossings: int | None
    max_grade_pct: float | None = None


def cell_of(lat: float, lon: float) -> str:
    return f"{math.floor(lat / LAMP_CELL_LAT)}:{math.floor(lon / LAMP_CELL_LON)}"


def climb_m(heights: list[float] | None) -> float | None:
    if not heights:
        return None
    low = heights[0]
    total = 0.0
    for height in heights[1:]:
        if height < low:
            low = height
        elif height >= low + 1:
            total += height - low
            low = height
    return round(total, 1)


def max_grade_pct(heights: list[float] | None, distance_m: float) -> float | None:
    if not heights or len(heights) < 2 or distance_m <= 0:
        return None
    if distance_m < 40:
        return round(abs(heights[-1] - heights[0]) / distance_m * 100, 1)
    # Regular 20 m samples, followed by a possibly shorter final segment.
    distances = [min(i * LIT_SAMPLE_EVERY_M, distance_m) for i in range(len(heights) - 1)] + [distance_m]
    grades = []
    start = 0
    for i, d in enumerate(distances):
        if d < 40:
            continue
        target = d - 40
        while start + 1 < i and distances[start + 1] < target:
            start += 1
        span = distances[start + 1] - distances[start]
        fraction = (target - distances[start]) / span if span else 0
        old = heights[start] + fraction * (heights[start + 1] - heights[start])
        grades.append(abs(heights[i] - old) / 40 * 100)
    return round(max(grades), 1) if grades else None


def _read_json(name: str) -> dict | None:
    try:
        data = json.loads((DATA_DIR / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _index_key(lat: float, lon: float) -> tuple[int, int]:
    return math.floor(lat / _INDEX_CELL_DEG), math.floor(lon / _INDEX_CELL_DEG)


@lru_cache(maxsize=1)
def _load_crossings() -> dict[tuple[int, int], list[tuple[float, float, str]]] | None:
    data = _read_json("crossings.json")
    if data is None:
        return None
    index: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
    try:
        for kind in _KINDS:
            for lat, lon in data[kind]:
                index.setdefault(_index_key(lat, lon), []).append((lat, lon, kind))
    except (KeyError, TypeError, ValueError):
        return None
    return index


@lru_cache(maxsize=1)
def _load_lamp_cells() -> frozenset[str] | None:
    data = _read_json("lamp_grid.json")
    if data is None or not isinstance(data.get("cells"), list):
        return None
    return frozenset(data["cells"])


def _to_metres(origin: LatLon, point: LatLon) -> tuple[float, float]:
    x = (point[1] - origin[1]) * _M_PER_DEG_LAT * math.cos(math.radians(origin[0]))
    y = (point[0] - origin[0]) * _M_PER_DEG_LAT
    return x, y


def _distance_to_segment_m(point: LatLon, a: LatLon, b: LatLon) -> float:
    ax, ay = _to_metres(point, a)
    bx, by = _to_metres(point, b)
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length2))
    return math.hypot(ax + t * dx, ay + t * dy)


def _segments(geometry: list[LatLon]) -> list[tuple[LatLon, LatLon]]:
    return list(zip(geometry, geometry[1:])) if len(geometry) > 1 else [(p, p) for p in geometry]


def _count_crossings(geometry: list[LatLon], index: dict) -> dict[str, int]:
    pad = CROSSING_BUFFER_M / _M_PER_DEG_LAT * 1.5
    found: set[tuple[float, float, str]] = set()
    for a, b in _segments(geometry):
        lat_low, lon_low = _index_key(min(a[0], b[0]) - pad, min(a[1], b[1]) - pad)
        lat_high, lon_high = _index_key(max(a[0], b[0]) + pad, max(a[1], b[1]) + pad)
        for i in range(lat_low, lat_high + 1):
            for j in range(lon_low, lon_high + 1):
                for crossing in index.get((i, j), ()):
                    if crossing not in found and _distance_to_segment_m(crossing[:2], a, b) <= CROSSING_BUFFER_M:
                        found.add(crossing)
    return {kind: sum(c[2] == kind for c in found) for kind in _KINDS}


def _samples(geometry: list[LatLon]) -> list[LatLon]:
    if not geometry:
        return []
    samples = [geometry[0]]
    until_next = LIT_SAMPLE_EVERY_M
    for a, b in zip(geometry, geometry[1:]):
        x, y = _to_metres(a, b)
        length = math.hypot(x, y)
        walked = until_next
        while walked < length:
            t = walked / length
            samples.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            walked += LIT_SAMPLE_EVERY_M
        until_next = walked - length
    if len(geometry) > 1 and samples[-1] != geometry[-1]:
        samples.append(geometry[-1])
    return samples


def _near_lamp(point: LatLon, cells: frozenset[str]) -> bool:
    return any(
        cell_of(point[0] + i * LAMP_CELL_LAT, point[1] + j * LAMP_CELL_LON) in cells
        for i in (-1, 0, 1)
        for j in (-1, 0, 1)
    )


def _lit_ratio(geometry: list[LatLon], cells: frozenset[str]) -> float | None:
    samples = _samples(geometry)
    if not samples:
        return None
    return round(sum(_near_lamp(p, cells) for p in samples) / len(samples), 2)


def measure(route: EngineRoute) -> Metrics:
    index = _load_crossings()
    cells = _load_lamp_cells()
    counts = _count_crossings(route.geometry, index) if index is not None else None
    samples = _samples(route.geometry)
    heights = [elevation.height(*point) for point in samples]
    heights = heights if heights and all(h is not None for h in heights) else None
    distance = sum(math.hypot(*_to_metres(a, b)) for a, b in zip(route.geometry, route.geometry[1:]))
    return Metrics(
        steps=sum(m.kind == "stairs" for m in route.maneuvers),
        climb_m=climb_m(heights),
        max_grade_pct=max_grade_pct(heights, distance),
        lit_ratio=_lit_ratio(route.geometry, cells) if cells is not None else None,
        unsignalized_crossings=counts["unsignalized"] if counts else None,
        signal_crossings=counts["signal"] if counts else None,
        unknown_crossings=counts["unknown"] if counts else None,
    )
