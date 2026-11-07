"""Build api/data/safety_points.json: CCTV locations of the Taipei City Police Department.

Sources
- Cameras: https://data.gov.tw/dataset/130094 (CSV, addresses only, Open Government Data License v1)
- Police stations: https://data.gov.tw/dataset/130095 (CSV, 112 offices, addresses only). An exact address match wins;
  otherwise the office is looked up by name in Overture `places`.
- Coordinates: Overture Maps `addresses` theme (CDLA-Permissive-2.0), queried once at build time.
  Nothing is geocoded at request time, and no user location leaves the device.

Only the position matters (no shooting direction). Each address is resolved at the best tier it allows:
  exact         street + lane + alley + house number found
  nearby_number same street/lane, closest house number of the same parity within NEARBY_NUMBER_GAP
  lane          lane given but no house number: centroid of the lane's addresses
  intersection  "A路與B路口": midpoint between the closest address points of the two streets
Addresses that cannot be resolved are dropped, so `cameraCoverage` is reported.

Usage: build_safety_points.py [--release 2026-10-21.0] [--cameras local.csv] [--addresses local.parquet]
The Overture extract is cached in scripts/.cache (not committed).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import statistics
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

CAMERA_URL = (
    "https://data.taipei/api/dataset/e9b913ee-6df8-4663-bee5-aef6729d4389"
    "/resource/5929d4ff-b7c5-4fa1-94e3-9d45576e8f37/download"
)
CAMERA_DATASET = "臺北市政府警察局錄影監視系統設置區位"
POLICE_URL = (
    "https://data.taipei/api/dataset/6c41536a-3ce2-4102-bdfc-6b5f3d13ef91"
    "/resource/a90ae184-c39e-4242-b2d6-d7a0403c0632/download"
)
POLICE_DATASET = "臺北市政府警察局名稱及地址"
ADDRESS_SOURCE = "Overture Maps addresses"
PLACE_SOURCE = "Overture Maps places"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "api" / "data" / "safety_points.json"
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
DEFAULT_RELEASE = "2026-10-21.0"

NEARBY_NUMBER_GAP = 8  # house numbers
INTERSECTION_MAX_M = 80  # the two streets' address points must come this close
AMBIGUOUS_SPREAD_M = 250  # same address in different districts: accept only if they agree this closely
CELL_DEG = 0.001  # ~100 m, for the intersection search

_ZH_DIGITS = "零一二三四五六七八九十"


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").replace("台", "臺")
    return re.sub(r"\s+", "", text)


def _zh_number(n: int) -> str:
    if n <= 10:
        return _ZH_DIGITS[n]
    if n < 20:
        return "十" + _ZH_DIGITS[n - 10]
    tens, ones = divmod(n, 10)
    return _ZH_DIGITS[tens] + "十" + (_ZH_DIGITS[ones] if ones else "")


def _street_key(base: str, section: str | None, lane: str | None, alley: str | None) -> str:
    key = base
    if section:
        key += (_zh_number(int(section)) if section.isdigit() else section) + "段"
    if lane:
        key += f"{lane}巷"
    if alley:
        key += f"{alley}弄"
    return key


_ROAD = r"(?P<base>[^\d、,，&＆與和及\-()（）]*?(?:路|街|道))"
_SECTION = r"(?:(?P<sec>\d+|[一二三四五六七八九十]+)段)?"
_PARTS = rf"{_SECTION}(?:(?P<lane>\d+)巷)?(?:(?P<alley>\d+)弄)?"
_ADDRESS_RE = re.compile(rf"^{_ROAD}{_PARTS}(?:(?P<num>\d+(?:[-之]\d+)?)號)?")
_STREET_TOKEN_RE = re.compile(rf"^{_ROAD}{_PARTS}")
_INTERSECTION_SPLIT = re.compile(r"[、,，&＆與和及]")


def _strip_prefix(text: str) -> str:
    text = _norm(text)
    text = re.sub(r"^(?:臺北市|北市)", "", text)
    return re.sub(r"^[一-鿿]{1,3}區", "", text)


def _number_key(num: str) -> str:
    return num.replace("之", "-")


def parse_address(raw: str) -> dict | None:
    """Return {"street", "number"|None, "lane": bool} for a house-level address, else None."""
    text = _strip_prefix(raw)
    if re.search(r"[與和及&＆、,，]", text.split("號")[0]) and not re.match(r"^[^\d]*?(?:路|街|大道)\d", text):
        return None  # looks like an intersection, handled by parse_intersection
    m = _ADDRESS_RE.match(text)
    if not m or not m.group("base"):
        return None
    street = _street_key(m.group("base"), m.group("sec"), m.group("lane"), m.group("alley"))
    number = _number_key(m.group("num")) if m.group("num") else None
    if number is None and not (m.group("lane") or m.group("alley")):
        return None  # road only: too vague
    return {"street": street, "number": number, "lane": number is None}


def parse_intersection(raw: str) -> tuple[str, str] | None:
    text = _strip_prefix(raw)
    parts = [p for p in _INTERSECTION_SPLIT.split(text) if p]
    if len(parts) != 2:
        return None
    streets = []
    for part in parts:
        m = _STREET_TOKEN_RE.match(part)
        if not m or not m.group("base") or m.group("lane") or m.group("alley"):
            return None
        streets.append(_street_key(m.group("base"), m.group("sec"), None, None))
    return (streets[0], streets[1]) if streets[0] != streets[1] else None


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    p = math.pi / 180
    x = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))


def _mean(points: list[tuple[float, float]]) -> tuple[float, float]:
    return statistics.fmean(p[0] for p in points), statistics.fmean(p[1] for p in points)


class AddressIndex:
    """Overture address points keyed by normalized street + house number."""

    def __init__(self, rows: list[tuple[str, str, str, float, float]]):
        """rows: (street, number, district, lon, lat) as stored by Overture."""
        self.by_number: dict[tuple[str, str], set[tuple[float, float]]] = defaultdict(set)
        self.by_street: dict[str, set[tuple[float, float]]] = defaultdict(set)
        self.numbers: dict[str, list[tuple[int, tuple[float, float]]]] = defaultdict(list)
        for street, number, _district, lon, lat in rows:
            street = _norm(street)
            number = _number_key(re.sub(r"號$", "", _norm(number)))
            if not street or lon is None or lat is None:
                continue
            point = (round(lat, 6), round(lon, 6))
            self.by_street[street].add(point)
            if number:
                self.by_number[(street, number)].add(point)
        for (street, number), points in self.by_number.items():
            main = re.match(r"\d+", number)
            if main:
                center = _mean(list(points))
                if max(_haversine_m(center, p) for p in points) <= AMBIGUOUS_SPREAD_M:
                    self.numbers[street].append((int(main.group()), center))

    def exact(self, street: str, number: str) -> tuple[float, float] | None:
        points = list(self.by_number.get((street, number), ()))
        if not points:
            return None
        center = _mean(points)
        # same address in several districts that disagree: refuse to guess
        if max(_haversine_m(center, p) for p in points) > AMBIGUOUS_SPREAD_M:
            return None
        return center

    def nearby_number(self, street: str, number: str) -> tuple[float, float] | None:
        main = re.match(r"\d+", number)
        if not main:
            return None
        want = int(main.group())
        candidates = [
            (abs(n - want), point)
            for n, point in self.numbers.get(street, ())
            if n % 2 == want % 2 and abs(n - want) <= NEARBY_NUMBER_GAP
        ]
        if not candidates:
            return None
        gap = min(c[0] for c in candidates)
        points = [point for g, point in candidates if g == gap]
        center = _mean(points)
        # neighbours in different districts can be far apart: refuse to guess
        return center if max(_haversine_m(center, p) for p in points) <= AMBIGUOUS_SPREAD_M else None

    def street_center(self, street: str) -> tuple[float, float] | None:
        points = list(self.by_street.get(street, ()))
        if not points:
            return None
        center = _mean(points)
        return center if max(_haversine_m(center, p) for p in points) <= AMBIGUOUS_SPREAD_M else None

    def intersection(self, a: str, b: str) -> tuple[float, float] | None:
        points_a, points_b = self.by_street.get(a), self.by_street.get(b)
        if not points_a or not points_b:
            return None
        grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
        for p in points_b:
            grid[(math.floor(p[0] / CELL_DEG), math.floor(p[1] / CELL_DEG))].append(p)
        best: tuple[float, tuple[float, float], tuple[float, float]] | None = None
        for p in points_a:
            ci, cj = math.floor(p[0] / CELL_DEG), math.floor(p[1] / CELL_DEG)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for q in grid.get((ci + di, cj + dj), ()):
                        d = _haversine_m(p, q)
                        if best is None or d < best[0]:
                            best = (d, p, q)
        if best is None or best[0] > INTERSECTION_MAX_M:
            return None
        return _mean([best[1], best[2]])


def resolve(address: str, index: AddressIndex) -> tuple[str, tuple[float, float]] | None:
    """Return (tier, (lat, lon)) or None."""
    parsed = parse_address(address)
    if parsed:
        street, number = parsed["street"], parsed["number"]
        if number:
            point = index.exact(street, number)
            if point:
                return "exact", point
            point = index.nearby_number(street, number)
            if point:
                return "nearby_number", point
        else:
            point = index.street_center(street)
            if point:
                return "lane", point
        return None
    pair = parse_intersection(address)
    if pair:
        point = index.intersection(*pair)
        if point:
            return "intersection", point
    return None


class PlaceIndex:
    """Overture POIs whose name looks like a police office, keyed by name."""

    def __init__(self, rows: list[tuple[str, float, float]]):
        """rows: (name, lon, lat)."""
        self.by_name: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for name, lon, lat in rows:
            if name and lon is not None and lat is not None:
                self.by_name[_norm(name)].append((lat, lon))

    def find(self, name: str, near: tuple[float, float] | None = None) -> tuple[float, float] | None:
        """Unique POI whose name contains `name`; with several, the one closest to `near` (within 1 km)."""
        name = _norm(name)
        candidates = [p for key, pts in self.by_name.items() if name in key for p in pts]
        if not candidates:
            return None
        if near is None:
            return candidates[0] if len(candidates) == 1 else None
        best = min(candidates, key=lambda p: _haversine_m(near, p))
        return best if _haversine_m(near, best) <= 1000 else None


def resolve_police(row: dict, index: AddressIndex, places: PlaceIndex | None) -> tuple[str, tuple[float, float]] | None:
    """Exact address wins. Otherwise a named POI (near the address when we have one), else the nearby-number guess."""
    address_hit = resolve(row.get("display_addr") or row.get("poi_addr") or "", index)
    if address_hit and address_hit[0] == "exact":
        return address_hit
    if places is not None:
        point = places.find(row.get("name", ""), address_hit[1] if address_hit else None)
        if point:
            return "place", point
    return address_hit


def build_police(police_rows: list[dict], index: AddressIndex, places: PlaceIndex | None) -> tuple[list, dict]:
    police, tiers = [], Counter()
    for row in police_rows:
        hit = resolve_police(row, index, places)
        if hit is None:
            tiers["unresolved"] += 1
            continue
        tier, (lat, lon) = hit
        tiers[tier] += 1
        police.append([round(lat, 5), round(lon, 5), row.get("name", "")])
    coverage = {
        "rows": len(police_rows),
        "resolved": len(police),
        "coverage": round(len(police) / len(police_rows), 3) if police_rows else 0,
        "tiers": dict(tiers),
    }
    return police, coverage


def build(
    camera_rows: list[dict],
    index: AddressIndex,
    updated_at: str,
    police_rows: list[dict] | None = None,
    places: PlaceIndex | None = None,
) -> dict:
    police, police_coverage = build_police(police_rows or [], index, places)
    addresses = sorted({_norm(r.get("安裝地址", "")) for r in camera_rows} - {""})
    tiers: Counter = Counter()
    points: set[tuple[float, float]] = set()
    for address in addresses:
        result = resolve(address, index)
        if result is None:
            tiers["unresolved"] += 1
            continue
        tier, (lat, lon) = result
        tiers[tier] += 1
        points.add((round(lat, 5), round(lon, 5)))
    resolved = len(addresses) - tiers["unresolved"]
    return {
        "updatedAt": updated_at,
        "sources": [CAMERA_DATASET, POLICE_DATASET, ADDRESS_SOURCE, PLACE_SOURCE],
        "police": police,
        "policeCoverage": police_coverage,
        "cameras": sorted([list(p) for p in points]),
        "cameraCoverage": {
            "cameraRows": len(camera_rows),
            "uniqueAddresses": len(addresses),
            "resolvedAddresses": resolved,
            "coverage": round(resolved / len(addresses), 3) if addresses else 0,
            "tiers": dict(tiers),
            "points": len(points),
        },
    }


def read_cameras(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def _fetch_csv(url: str, path: str | None) -> list[dict]:
    if path:
        return read_cameras(Path(path).read_text(encoding="utf-8-sig"))
    import httpx

    response = httpx.get(url, timeout=120, follow_redirects=True).raise_for_status()
    return read_cameras(response.content.decode("utf-8-sig"))


def fetch_cameras(path: str | None) -> list[dict]:
    return _fetch_csv(CAMERA_URL, path)


def fetch_police(path: str | None) -> list[dict]:
    return _fetch_csv(POLICE_URL, path)


def fetch_places(release: str, local: str | None) -> list[tuple]:
    import duckdb

    con = duckdb.connect()
    path = Path(local) if local else CACHE_DIR / f"taipei_police_places_{release}.parquet"
    if not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
        src = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
        con.execute(
            f"""COPY (SELECT names.primary AS name, bbox.xmin AS lon, bbox.ymin AS lat
                FROM read_parquet('{src}', hive_partitioning=1)
                WHERE bbox.xmin BETWEEN 121.45 AND 121.67 AND bbox.ymin BETWEEN 24.95 AND 25.21
                  AND (names.primary LIKE '%派出所%' OR names.primary LIKE '%分局%' OR names.primary LIKE '%警察局%'))
                TO '{path}' (FORMAT parquet)"""
        )
    return con.execute(f"SELECT name, lon, lat FROM '{path}'").fetchall()


def fetch_addresses(release: str, local: str | None) -> list[tuple]:
    import duckdb

    con = duckdb.connect()
    path = Path(local) if local else CACHE_DIR / f"taipei_addresses_{release}.parquet"
    if not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
        src = f"s3://overturemaps-us-west-2/release/{release}/theme=addresses/type=address/*"
        con.execute(
            f"""COPY (SELECT street, number, address_levels[2].value AS district, bbox.xmin AS lon, bbox.ymin AS lat
                FROM read_parquet('{src}', hive_partitioning=1)
                WHERE country='TW' AND address_levels[1].value='臺北市'
                  AND bbox.xmin BETWEEN 121.45 AND 121.67 AND bbox.ymin BETWEEN 24.95 AND 25.21)
                TO '{path}' (FORMAT parquet)"""
        )
    return con.execute(f"SELECT street, number, district, lon, lat FROM '{path}'").fetchall()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", default=DEFAULT_RELEASE)
    parser.add_argument("--cameras", help="local camera CSV instead of downloading")
    parser.add_argument("--addresses", help="local Overture extract (parquet)")
    parser.add_argument("--police", help="local police CSV instead of downloading")
    parser.add_argument("--places", help="local Overture police POI extract (parquet)")
    args = parser.parse_args()

    cameras = fetch_cameras(args.cameras)
    police = fetch_police(args.police)
    index = AddressIndex(fetch_addresses(args.release, args.addresses))
    places = PlaceIndex(fetch_places(args.release, args.places))
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    out = build(cameras, index, updated_at, police, places)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    p = out["policeCoverage"]
    print(f"police rows={p['rows']} resolved={p['resolved']} coverage={p['coverage']:.1%} tiers={p['tiers']}")
    c = out["cameraCoverage"]
    print(f"rows={c['cameraRows']} addresses={c['uniqueAddresses']} resolved={c['resolvedAddresses']} "
          f"coverage={c['coverage']:.1%} points={c['points']} tiers={c['tiers']}")


if __name__ == "__main__":
    main()
