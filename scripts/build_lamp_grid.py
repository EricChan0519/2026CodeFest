"""Build api/data/lamp_grid.json from the Taipei street lamp open dataset.

Usage: build_lamp_grid.py [local TaipeiLight.json]. The 51 MB source file stays out of the repo.
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from pyproj import Transformer

SOURCE_URL = "https://tppkl.blob.core.windows.net/blobfs/TaipeiLight.json"
OUTPUT = Path(__file__).resolve().parents[1] / "api" / "data" / "lamp_grid.json"
CELL_LAT = 0.00027
CELL_LON = 0.0003
_TO_WGS84 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)


def twd97_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon, lat = _TO_WGS84.transform(x, y)
    return lat, lon


def cell_of(lat: float, lon: float) -> str:
    return f"{math.floor(lat / CELL_LAT)}:{math.floor(lon / CELL_LON)}"


def _to_lat_lon(row: dict) -> tuple[float, float] | None:
    try:
        lat, lon = twd97_to_wgs84(float(row["TWD97X"]), float(row["TWD97Y"]))
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lon) if 24.9 < lat < 25.3 and 121.4 < lon < 121.7 else None


def build(rows: list[dict], updated_at: str) -> tuple[dict, int]:
    points = [p for p in map(_to_lat_lon, rows) if p]
    cells = sorted({cell_of(lat, lon) for lat, lon in points})
    return {"updatedAt": updated_at, "cells": cells}, len(points)


def main() -> None:
    if len(sys.argv) > 1:
        rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    else:
        rows = httpx.get(SOURCE_URL, timeout=300, follow_redirects=True).raise_for_status().json()
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    out, used = build(rows, updated_at)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"rows={len(rows)} used={used} cells={len(out['cells'])}")


if __name__ == "__main__":
    main()
