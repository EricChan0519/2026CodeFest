"""由 TDX 資料建立可離線使用的站位快照。"""
import argparse
import asyncio
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

try:
    from scripts.tdx import tdx_get
except ModuleNotFoundError:
    from tdx import tdx_get

ROOT = Path(__file__).resolve().parents[1]
VALID_BEARINGS = {"E", "W", "S", "N", "SE", "NE", "SW", "NW"}
VALID_DIRECTIONS = {0, 1, 2, 10, 255}
PAGE_SIZE = 5000


def clean(value):
    return None if value is None or value == "" else value


def _build(stop_of_route, stops, routes, updated_at):
    stop_lookup = {s.get("StopUID"): s for s in stops}
    route_lookup = {r.get("RouteUID"): r for r in routes}
    groups = {}
    excluded = missing = 0
    for route in stop_of_route:
        uid = clean(route.get("RouteUID"))
        direction = route.get("Direction")
        if direction not in VALID_DIRECTIONS:
            direction = 255
        metadata = route_lookup.get(uid, {})
        prefix = "Destination" if direction == 0 else "Departure" if direction == 1 else None
        zh = clean(metadata.get(prefix + "StopNameZh")) if prefix else None
        en = clean(metadata.get(prefix + "StopNameEn")) if prefix else None
        headsign = {"zh": "往" + zh if zh else None, "en": "To " + en if en else None}
        route_name = route.get("RouteName") or {}
        for stop in route.get("Stops") or []:
            if stop.get("StopBoarding") == -1:
                excluded += 1
            stop_uid = clean(stop.get("StopUID"))
            station_id = clean(stop.get("StationID"))
            if station_id is None:
                missing += 1
                continue
            position = stop.get("StopPosition") or {}
            lat, lon = clean(position.get("PositionLat")), clean(position.get("PositionLon"))
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            station_id = str(station_id)
            name = stop.get("StopName") or {}
            group = groups.setdefault(station_id, {"name": {"zh": clean(name.get("Zh_tw")), "en": clean(name.get("En"))}, "points": {}, "routes": {}, "bearings": {}})
            group["points"].setdefault(stop_uid, (lat, lon))
            bearing = clean(stop_lookup.get(stop_uid, {}).get("Bearing"))
            group["bearings"].setdefault(stop_uid, bearing if bearing in VALID_BEARINGS else None)
            if stop.get("StopBoarding") == -1:
                continue
            key = (uid, direction, stop_uid)
            group["routes"].setdefault(key, {"routeName": {"zh": clean(route_name.get("Zh_tw")), "en": clean(route_name.get("En"))}, "direction": direction, "headsign": headsign, "stopUid": stop_uid})
    stations = []
    for station_id, group in sorted(groups.items(), key=lambda item: "TPE" + item[0]):
        if not group["routes"]:
            continue
        points = list(group["points"].values())
        counts = Counter(b for b in group["bearings"].values() if b is not None)
        bearing = sorted(counts, key=lambda b: (-counts[b], b))[0] if counts else None
        stations.append({"stationUid": "TPE" + station_id, "name": group["name"], "bearing": bearing,
                         "lat": round(sum(p[0] for p in points) / len(points), 6),
                         "lon": round(sum(p[1] for p in points) / len(points), 6),
                         "routes": sorted(group["routes"].values(), key=lambda r: (r["routeName"]["zh"] or "", r["direction"], r["stopUid"] or ""))})
    return {"updatedAt": updated_at, "stations": stations}, excluded, missing


def build_index(stop_of_route: list, stops: list, routes: list, updated_at: str) -> dict:
    return _build(stop_of_route, stops, routes, updated_at)[0]


async def fetch_all(path, retries=10):
    """依序分頁抓取；TDX 有頻率限制（實測每分鐘 5 次），遇到 429 就照 Retry-After 等待重試。"""
    result = []
    while True:
        for attempt in range(retries):
            try:
                page = await tdx_get(path, {"$format": "JSON", "$top": PAGE_SIZE, "$skip": len(result)})
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code != 429 or attempt == retries - 1:
                    raise
                # TDX 限制每分鐘 5 次，依 Retry-After 等待
                await asyncio.sleep(int(exc.response.headers.get("retry-after", 2 ** attempt)) + 1)
        result.extend(page)
        if len(page) < PAGE_SIZE:
            return result
        await asyncio.sleep(0.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="api/data/stop_index.json")
    args = parser.parse_args()
    async def fetch():
        # 依序抓，避免同時打 TDX 觸發 429
        return [await fetch_all(f"/v2/Bus/{kind}/City/Taipei") for kind in ("StopOfRoute", "Stop", "Route")]
    stop_of_route, stops, routes = asyncio.run(fetch())
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    data, excluded, missing = _build(stop_of_route, stops, routes, updated_at)
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    stations = data["stations"]
    english = sum(bool(s["name"]["en"]) for s in stations)
    print(f"站位數：{len(stations)}；英文站名比例：{english / len(stations) * 100 if stations else 0:.1f}%；只能下車排除筆數：{excluded}；無 StationID 略過筆數：{missing}")


if __name__ == "__main__":
    main()
