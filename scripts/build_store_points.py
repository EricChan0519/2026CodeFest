#!/usr/bin/env python3
"""Build api/data/store_points.json: convenience stores and storefronts along Taipei streets.

Used by the "safe" route mode: a street with convenience stores (most are open 24 hours and many are
Taipei's 婦幼安全守護站) and shops has people around. Built offline from the two Overture Maps Places
snapshots that are already in the repo, so it needs no network and no keys:

  - web/public/lab/poi_index.json   chains (7-ELEVEN, FamilyMart, ...), from scripts/build_poi_index.py
  - api/data/place_index.json.gz    other places (restaurants, shops, ...), from scripts/build_place_index.py

Overture Maps Places: CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0, attribution required.

Output:
  { "updatedAt", "source", "release", "license",
    "convenience": [[lat, lon], ...],      convenience stores, de-duplicated within ~30 m
    "shopCells": ["i:j", ...] }             lamp-grid cells (about 30 m) with at least one storefront

Usage: python3 scripts/build_store_points.py
"""
from __future__ import annotations

import gzip
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POI_INDEX = ROOT / "web" / "public" / "lab" / "poi_index.json"
PLACE_INDEX = ROOT / "api" / "data" / "place_index.json.gz"
OUTPUT = ROOT / "api" / "data" / "store_points.json"

# Same box as the routing graph (routing/Dockerfile).
BBOX = dict(lat_min=24.96, lat_max=25.21, lon_min=121.45, lon_max=121.67)
CONVENIENCE_BRANDS = {"7-11", "familymart", "hilife", "okmart"}
CONVENIENCE_CATEGORIES = {"便利商店"}
# Places with a storefront that is usually open into the evening. Schools, temples, parks... are not.
SHOP_CATEGORIES = {
    "便利商店", "餐廳", "商店", "咖啡廳", "餐飲", "早午餐", "小吃攤", "麵包店", "茶館", "超市", "藥局",
    "甜點店", "冰店", "酒吧", "飲料店", "書店", "百貨公司", "購物中心", "銀行", "郵局",
}
# Same grid as scripts/build_lamp_grid.py and api/app/metrics.py.
CELL_LAT = 0.00027
CELL_LON = 0.0003
DEDUPE_M = 30


def in_bbox(lat: float, lon: float) -> bool:
    return BBOX["lat_min"] <= lat <= BBOX["lat_max"] and BBOX["lon_min"] <= lon <= BBOX["lon_max"]


def cell_of(lat: float, lon: float) -> str:
    return f"{math.floor(lat / CELL_LAT)}:{math.floor(lon / CELL_LON)}"


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    dy = (b[0] - a[0]) * 111_195.0
    dx = (b[1] - a[1]) * 111_195.0 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def dedupe(points: list[tuple[float, float]], within_m: float = DEDUPE_M) -> list[tuple[float, float]]:
    """Keep one point per store: Overture often has the same store twice a few metres apart."""
    kept: list[tuple[float, float]] = []
    buckets: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for p in sorted(points):
        key = (math.floor(p[0] / 0.001), math.floor(p[1] / 0.001))
        near = [q for i in (-1, 0, 1) for j in (-1, 0, 1) for q in buckets.get((key[0] + i, key[1] + j), ())]
        if any(_metres(p, q) < within_m for q in near):
            continue
        kept.append(p)
        buckets.setdefault(key, []).append(p)
    return kept


def build(poi: dict, places: dict, updated_at: str) -> dict:
    brands = poi["brands"]
    convenience: list[tuple[float, float]] = []
    shops: set[str] = set()
    for brand, _name, lat, lon, *_ in poi["places"]:
        if not in_bbox(lat, lon):
            continue
        shops.add(cell_of(lat, lon))
        if brands[brand]["key"] in CONVENIENCE_BRANDS:
            convenience.append((round(lat, 6), round(lon, 6)))
    categories = places["categories"]
    for _name, lat, lon, _address, category, *_ in places["places"]:
        if not in_bbox(lat, lon):
            continue
        label = categories[category]
        if label in SHOP_CATEGORIES:
            shops.add(cell_of(lat, lon))
        if label in CONVENIENCE_CATEGORIES:
            convenience.append((round(lat, 6), round(lon, 6)))
    return {
        "updatedAt": updated_at,
        "source": "Overture Maps Places",
        "release": poi.get("release") or places.get("release"),
        "license": "CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0",
        "convenience": [list(p) for p in dedupe(convenience)],
        "shopCells": sorted(shops),
    }


def main() -> None:
    poi = json.loads(POI_INDEX.read_text(encoding="utf-8"))
    with gzip.open(PLACE_INDEX, "rt", encoding="utf-8") as f:
        places = json.load(f)
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    out = build(poi, places, updated_at)
    OUTPUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"convenience={len(out['convenience'])} shopCells={len(out['shopCells'])} -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
