"""由 TDX 資料建立可離線使用的站位快照。"""
import argparse
import asyncio
import json
import re
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


WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
WEEKEND = ("Saturday", "Sunday")
# 營運日從清晨 4 點算起：末班 00:30 記成 24:30
SERVICE_DAY_START_H = 4


def _clock_s(text):
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?", str(text or "").strip())
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return (h + 24 if h < SERVICE_DAY_START_H else h) * 3600 + mi * 60


def service_windows(schedule) -> dict:
    """TDX Bus Schedule → {(路線中文名, 方向): {"weekday": [首班, 末班], "weekend": [...]}}，秒數是起點站發車時間。

    班表（Timetables）取每一班第一站的發車時間；班距（Frequencys）取 StartTime／EndTime。
    同一路線方向有多筆（副路線）時取最早首班、最晚末班。沒有資料的日子是 None。
    """
    acc = {}
    for entry in schedule or []:
        name = clean((entry.get("RouteName") or {}).get("Zh_tw"))
        direction = entry.get("Direction")
        if not name or direction is None:
            continue
        spans = []
        for t in entry.get("Timetables") or []:
            times = sorted(t.get("StopTimes") or [], key=lambda x: x.get("StopSequence", 0))
            if not times:
                continue
            at = _clock_s(times[0].get("DepartureTime") or times[0].get("ArrivalTime"))
            if at is not None:
                spans.append((t.get("ServiceDay") or {}, at, at))
        for f in entry.get("Frequencys") or []:
            start, end = _clock_s(f.get("StartTime")), _clock_s(f.get("EndTime"))
            if start is not None and end is not None:
                spans.append((f.get("ServiceDay") or {}, start, end))
        slot = acc.setdefault((name, direction), {"weekday": None, "weekend": None})
        for day, first, last in spans:
            for key, names in (("weekday", WEEKDAYS), ("weekend", WEEKEND)):
                if not any(day.get(n) for n in names):
                    continue
                cur = slot[key]
                slot[key] = [min(cur[0], first), max(cur[1], last)] if cur else [first, last]
    return acc


def _build(stop_of_route, stops, routes, updated_at, schedule=None):
    stop_lookup = {s.get("StopUID"): s for s in stops}
    route_lookup = {r.get("RouteUID"): r for r in routes}
    groups = {}
    sequences = []
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
        ordered = []
        sequences.append(({"zh": clean(route_name.get("Zh_tw")), "en": clean(route_name.get("En"))}, direction, headsign, ordered))
        for position_in_list, stop in enumerate(route.get("Stops") or []):
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
            sequence = stop.get("StopSequence")
            ordered.append((sequence if isinstance(sequence, (int, float)) else position_in_list, position_in_list, "TPE" + station_id, stop.get("StopBoarding")))
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
    patterns = _patterns(sequences, {s["stationUid"] for s in stations})
    if schedule:
        windows = service_windows(schedule)
        for p in patterns:
            w = windows.get((p["routeName"]["zh"], p["direction"]))
            if w and (w["weekday"] or w["weekend"]):
                p["service"] = w
    return {"updatedAt": updated_at, "stations": stations, "patterns": patterns}, excluded, missing


def _patterns(sequences, known):
    """每條路線、每個方向的停靠順序，給「搭哪一班直達車」用。

    stops 是依 StopSequence 排好的 stationUid；同一站位連續出現時合併。
    noBoard／noAlight 是 stops 的索引：StopBoarding 1 只能上車、-1 只能下車。
    只能下車、且所在站位沒有可上車路線的站位不在 stations 裡，這裡也略過。
    """
    patterns, seen = [], set()
    for route_name, direction, headsign, ordered in sequences:
        stops, board, alight = [], [], []
        for _, _, uid, boarding in sorted(ordered):
            if uid not in known:
                continue
            can_board, can_alight = boarding != -1, boarding != 1
            if stops and stops[-1] == uid:
                board[-1] = board[-1] or can_board
                alight[-1] = alight[-1] or can_alight
                continue
            stops.append(uid)
            board.append(can_board)
            alight.append(can_alight)
        if len(stops) < 2:
            continue
        key = (route_name["zh"], direction, tuple(stops))
        if key in seen:
            continue
        seen.add(key)
        patterns.append({"routeName": route_name, "direction": direction, "headsign": headsign, "stops": stops,
                         "noBoard": [i for i, ok in enumerate(board) if not ok],
                         "noAlight": [i for i, ok in enumerate(alight) if not ok]})
    return patterns


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
    parser.add_argument("--copy", default="web/public/lab/stop_index.json", help="再複製一份給前端；空字串表示不複製")
    args = parser.parse_args()
    async def fetch():
        # 依序抓，避免同時打 TDX 觸發 429
        got = [await fetch_all(f"/v2/Bus/{kind}/City/Taipei") for kind in ("StopOfRoute", "Stop", "Route")]
        try:
            # 首末班（選用）：抓不到時快照沒有 service，前端就不判斷末班車
            got.append(await fetch_all("/v2/Bus/Schedule/City/Taipei"))
        except httpx.HTTPError as exc:
            print(f"Schedule 抓不到（{exc}），快照不含首末班")
            got.append(None)
        return got
    stop_of_route, stops, routes, schedule = asyncio.run(fetch())
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    data, excluded, missing = _build(stop_of_route, stops, routes, updated_at, schedule)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for target in filter(None, [args.out, args.copy]):
        out = Path(target)
        if not out.is_absolute():
            out = ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        print(f"寫入 {out}")
    stations = data["stations"]
    english = sum(bool(s["name"]["en"]) for s in stations)
    with_service = sum("service" in p for p in data["patterns"])
    print(f"有首末班的路線方向：{with_service}／{len(data['patterns'])}")
    print(f"站位數：{len(stations)}；英文站名比例：{english / len(stations) * 100 if stations else 0:.1f}%；只能下車排除筆數：{excluded}；無 StationID 略過筆數：{missing}")


if __name__ == "__main__":
    main()
