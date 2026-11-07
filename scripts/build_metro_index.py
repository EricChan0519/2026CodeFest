"""由 TDX 臺北捷運資料建立可離線規劃的捷運快照 metro_index.json。

格式見 docs/arrow-nav/03-contracts.md「公車＋捷運規劃」；前端型別在 web/src/lib/metroIndex.ts。
TDX 的欄位名稱只出現在這支腳本。

端點（/api/basic/v2/Rail/Metro/{X}/{業者}，業者是 TRTC 臺北捷運，加上 NTMC 新北捷運的環狀線）：
- 必要：Station、StationOfLine、Line（欄位已由 NYCU TDX 套件原始碼確認）
- 選用：StationOfRoute、S2STravelTime、LineTransfer、StationExit、Frequency（欄位待用金鑰實測）
  讀不到或欄位不符時用預設值，並把欄位名稱寫進 defaults，關於頁和 README 據此說明。

用法（要 TDX_CLIENT_ID / TDX_CLIENT_SECRET）：
    python scripts/build_metro_index.py
預設寫到 api/data/metro_index.json，並複製到 web/public/lab/metro_index.json。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

try:
    from scripts.tdx import tdx_get
except ModuleNotFoundError:
    from tdx import tdx_get

ROOT = Path(__file__).resolve().parents[1]
# 臺北捷運（TRTC）是必要的；環狀線由新北捷運（NTMC）營運，抓不到時只少環狀線
OPERATORS = (("TRTC", True), ("NTMC", False))
# 只收捷運路線；NTMC 底下的淡海、安坑輕軌不收
ALLOWED_LINES = {"BR", "R", "G", "O", "BL", "Y"}
# 名稱不同、同名比對抓不到的轉乘站（LineTransfer 讀不到時才用）
EXTRA_TRANSFERS = (("Y15", "BL08"),)  # 新埔民生 ↔ 新埔

DEFAULT_RUN_S = 120
DEFAULT_HEADWAY_S = 360
DEFAULT_TRANSFER_S = 240
SAME_NAME_TRANSFER_M = 300

# TDX Line 沒有 LineColor 時用的官方代表色
OFFICIAL_COLORS = {
    "BR": "#C48C31",
    "R": "#E3002C",
    "G": "#008659",
    "O": "#F8B61C",
    "BL": "#0070BD",
    "Y": "#FFDB00",
}
FALLBACK_COLOR = "#5A6B73"

# StationOfLine 退路用：支線第一站接回主線的哪一站
BRANCH_JUNCTION = {"O50": "O12", "G03A": "G03", "R22A": "R22"}

_ID = re.compile(r"^([A-Z]+)(\d+)([A-Z]*)$")


def _clean(value):
    return None if value is None or value == "" else value


def _name(raw) -> dict:
    raw = raw or {}
    return {"zh": _clean(raw.get("Zh_tw")), "en": _clean(raw.get("En"))}


def _point(raw):
    raw = raw or {}
    lat, lon = raw.get("PositionLat"), raw.get("PositionLon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and lat and lon:
        return lat, lon
    return None


def _distance_m(a, b) -> float:
    r = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _ordered(stations) -> list[str]:
    rows = sorted(stations or [], key=lambda s: s.get("Sequence", 0))
    return [str(s["StationID"]) for s in rows if _clean(s.get("StationID"))]


def _split_branches(ids: list[str]) -> list[list[str]]:
    """StationOfLine 把支線接在主線後面（R…R28、R22A）。依編號斷開，支線補上接回主線的那一站。"""
    segments: list[list[str]] = []
    prev = None
    for sid in ids:
        m = _ID.match(sid)
        starts_new = prev is None or m is None
        if m and prev:
            prefix, num, suffix = m.group(1), int(m.group(2)), m.group(3)
            p_prefix, p_num, p_suffix = prev
            starts_new = bool(suffix) != bool(p_suffix) or prefix != p_prefix or abs(num - p_num) != 1
        if starts_new:
            junction = BRANCH_JUNCTION.get(sid)
            if junction is None and m and m.group(3):
                junction = m.group(1) + m.group(2)
            segments.append([junction] if junction and junction != sid else [])
        segments[-1].append(sid)
        prev = (m.group(1), int(m.group(2)), m.group(3)) if m else None
    return segments


def _sequences(station_of_line, station_of_route) -> tuple[list[tuple[str, list[str]]], bool]:
    """回傳 [(lineId, 依行駛順序的 stationId)]，兩個方向分開；第二個值表示是否用了 StationOfLine 退路。"""
    out: list[tuple[str, list[str]]] = []
    if station_of_route:
        for route in station_of_route:
            line, ids = _clean(route.get("LineID")), _ordered(route.get("Stations"))
            if line and len(ids) >= 2:
                out.append((line, ids))
        if out:
            # 有些資料只給一個方向：缺的方向用反向補
            have = {(line, tuple(ids)) for line, ids in out}
            for line, ids in list(out):
                if (line, tuple(reversed(ids))) not in have:
                    out.append((line, list(reversed(ids))))
                    have.add((line, tuple(reversed(ids))))
            return out, False
    for line_row in station_of_line or []:
        line = _clean(line_row.get("LineID"))
        if not line:
            continue
        for segment in _split_branches(_ordered(line_row.get("Stations"))):
            if len(segment) >= 2:
                out.append((line, segment))
                out.append((line, list(reversed(segment))))
    return out, True


def _run_lookup(s2s) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = {}
    for row in s2s or []:
        for t in row.get("TravelTimes") or []:
            a, z = _clean(t.get("FromStationID")), _clean(t.get("ToStationID"))
            run = t.get("RunTime")
            if not a or not z or not isinstance(run, (int, float)) or run <= 0:
                continue
            stop = t.get("StopTime") if isinstance(t.get("StopTime"), (int, float)) else 0
            out.setdefault((str(a), str(z)), int(run + stop))
    return out


def _headways(frequency) -> dict[str, int]:
    """每條線的平均班距：每個時段取最小與最大班距的中間值，再平均。"""
    acc: dict[str, list[float]] = {}
    for row in frequency or []:
        line = _clean(row.get("LineID"))
        for h in row.get("Headways") or []:
            lo, hi = h.get("MinHeadwayMins"), h.get("MaxHeadwayMins")
            if line and isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi > 0:
                acc.setdefault(line, []).append((lo + hi) / 2)
    return {line: round(sum(v) / len(v) * 60) for line, v in acc.items()}


def _exits(exits) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for e in exits or []:
        sid, point = _clean(e.get("StationID")), _point(e.get("ExitPosition"))
        if not sid or point is None:
            continue
        exit_id = str(_clean(e.get("ExitID")) or "")
        label = _name(e.get("ExitName"))["zh"] or exit_id
        elevator = e.get("Elevator")
        out.setdefault(str(sid), []).append({"exitId": exit_id, "name": label, "lat": point[0], "lon": point[1],
                                             "elevator": elevator if isinstance(elevator, bool) else None})
    return out


def _transfer_seconds(value) -> int | None:
    # TDX MinTransferTime 預期是分鐘；超過 30 視為已經是秒
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return int(value) if value > 30 else int(value * 60)


def build_metro_index(*, stations, lines, station_of_line, station_of_route, s2s, transfers, exits, frequency,
                      updated_at: str) -> dict:
    defaults: set[str] = set()

    sequences, used_line_fallback = _sequences(station_of_line, station_of_route)
    sequences = [(line, ids) for line, ids in sequences if line in ALLOWED_LINES]
    if used_line_fallback:
        # 支線接點是 BRANCH_JUNCTION 寫死的，不是 TDX 給的
        defaults.add("branches")

    runs = _run_lookup(s2s)
    patterns = []
    seen = set()
    for line, ids in sequences:
        if (line, tuple(ids)) in seen:
            continue
        seen.add((line, tuple(ids)))
        run_s = []
        for a, z in zip(ids, ids[1:]):
            value = runs.get((a, z)) or runs.get((z, a))
            if value is None:
                value = DEFAULT_RUN_S
                defaults.add("runS")
            run_s.append(value)
        patterns.append({"lineId": line, "stops": ids, "runS": run_s})

    raw_stations = {}
    for s in stations or []:
        sid, point = _clean(s.get("StationID")), _point(s.get("StationPosition"))
        if sid and point:
            raw_stations[str(sid)] = (s, point)

    patterns = [p for p in patterns if all(sid in raw_stations for sid in p["stops"])]
    used = {sid for p in patterns for sid in p["stops"]}

    exit_rows = _exits(exits)
    if not exit_rows:
        defaults.add("exits")
    out_stations = []
    for sid in sorted(used):
        raw, point = raw_stations[sid]
        out_stations.append({"stationId": sid, "name": _name(raw.get("StationName")), "lat": point[0], "lon": point[1],
                             "exits": exit_rows.get(sid, [])})
    names = {s["stationId"]: s["name"] for s in out_stations}

    for p in patterns:
        last = names[p["stops"][-1]]
        p["headsign"] = {"zh": "往" + last["zh"] if last["zh"] else None, "en": "To " + last["en"] if last["en"] else None}
    patterns = [{"lineId": p["lineId"], "headsign": p["headsign"], "stops": p["stops"], "runS": p["runS"]} for p in patterns]

    headways = _headways(frequency)
    line_rows = {str(l["LineID"]): l for l in lines or [] if _clean(l.get("LineID"))}
    out_lines = []
    for line in sorted({p["lineId"] for p in patterns}):
        raw = line_rows.get(line, {})
        color = _clean(raw.get("LineColor"))
        if not (isinstance(color, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", color)):
            color = OFFICIAL_COLORS.get(line, FALLBACK_COLOR)
            if line not in OFFICIAL_COLORS:
                defaults.add("color")
        headway = headways.get(line)
        if headway is None:
            headway = DEFAULT_HEADWAY_S
            defaults.add("headwayS")
        out_lines.append({"lineId": line, "name": _name(raw.get("LineName")), "color": color.upper(), "headwayS": headway})

    pairs: dict[tuple[str, str], int] = {}
    for t in transfers or []:
        a, z = _clean(t.get("FromStationID")), _clean(t.get("ToStationID"))
        walk = _transfer_seconds(t.get("MinTransferTime"))
        if a and z and a != z and walk and a in used and z in used:
            for key in ((str(a), str(z)), (str(z), str(a))):
                pairs[key] = min(pairs.get(key, walk), walk)
    if not pairs:
        defaults.add("transfers")
        coords = {s["stationId"]: (s["lat"], s["lon"]) for s in out_stations}
        for a in out_stations:
            for z in out_stations:
                if a["stationId"] != z["stationId"] and a["name"]["zh"] and a["name"]["zh"] == z["name"]["zh"] \
                        and _distance_m(coords[a["stationId"]], coords[z["stationId"]]) <= SAME_NAME_TRANSFER_M:
                    pairs[(a["stationId"], z["stationId"])] = DEFAULT_TRANSFER_S
        for a, z in EXTRA_TRANSFERS:
            if a in used and z in used:
                pairs[(a, z)] = pairs[(z, a)] = DEFAULT_TRANSFER_S
    out_transfers = [{"from": a, "to": z, "walkS": w} for (a, z), w in sorted(pairs.items())]

    return {"updatedAt": updated_at, "defaults": sorted(defaults), "lines": out_lines, "stations": out_stations,
            "patterns": patterns, "transfers": out_transfers}


def check_metro_index(d: dict) -> list[str]:
    """和 web/src/lib/metroIndex.ts 的 checkMetroIndex 相同的規則。"""
    errors = []
    line_ids = {l["lineId"] for l in d["lines"]}
    station_ids = {s["stationId"] for s in d["stations"]}
    for i, l in enumerate(d["lines"]):
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", l["color"]):
            errors.append(f"lines[{i}].color must be #RRGGBB")
        if not l["headwayS"] > 0:
            errors.append(f"lines[{i}].headwayS must be > 0")
    for i, s in enumerate(d["stations"]):
        if not (21 < s["lat"] < 26.5 and 119 < s["lon"] < 122.5):
            errors.append(f"stations[{i}] {s['stationId']} outside Taiwan")
    for i, p in enumerate(d["patterns"]):
        if p["lineId"] not in line_ids:
            errors.append(f"patterns[{i}].lineId unknown line {p['lineId']}")
        if len(p["stops"]) < 2:
            errors.append(f"patterns[{i}].stops needs at least 2 stations")
        for j, uid in enumerate(p["stops"]):
            if uid not in station_ids:
                errors.append(f"patterns[{i}].stops[{j}] unknown station {uid}")
        if len(p["runS"]) != len(p["stops"]) - 1:
            errors.append(f"patterns[{i}].runS length {len(p['runS'])}, expected {len(p['stops']) - 1}")
        if any(not s > 0 for s in p["runS"]):
            errors.append(f"patterns[{i}].runS must all be > 0")
    pairs = {(t["from"], t["to"]) for t in d["transfers"]}
    for i, t in enumerate(d["transfers"]):
        if t["from"] not in station_ids:
            errors.append(f"transfers[{i}].from unknown station {t['from']}")
        if t["to"] not in station_ids:
            errors.append(f"transfers[{i}].to unknown station {t['to']}")
        if (t["to"], t["from"]) not in pairs:
            errors.append(f"transfers[{i}] {t['from']}→{t['to']} has no reverse entry")
    return errors


async def _fetch(kind: str, operator: str, required: bool):
    path = f"/v2/Rail/Metro/{kind}/{operator}"
    for attempt in range(6):
        try:
            return await tdx_get(path, {"$format": "JSON"})
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 429 and attempt < 5:
                # TDX 限制每分鐘 5 次，依 Retry-After 等待
                await asyncio.sleep(int(exc.response.headers.get("retry-after", 2 ** attempt)) + 1)
                continue
            if required:
                raise
            print(f"  {operator} {kind}：HTTP {status}，略過")
            return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="api/data/metro_index.json")
    parser.add_argument("--copy", default="web/public/lab/metro_index.json", help="再複製一份給前端；空字串表示不複製")
    args = parser.parse_args()

    kinds = (("Station", True), ("StationOfLine", True), ("Line", True), ("StationOfRoute", False),
             ("S2STravelTime", False), ("LineTransfer", False), ("StationExit", False), ("Frequency", False))

    async def fetch():
        """每個端點把各業者的資料串在一起；全部業者都抓不到就是 None（用預設值）。"""
        got = {kind: None for kind, _ in kinds}
        # 依序抓，避免同時打 TDX 觸發 429
        for operator, operator_required in OPERATORS:
            for kind, kind_required in kinds:
                rows = await _fetch(kind, operator, operator_required and kind_required)
                if rows is not None:
                    got[kind] = (got[kind] or []) + rows
                await asyncio.sleep(0.5)
        return got

    raw = asyncio.run(fetch())
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    data = build_metro_index(stations=raw["Station"], lines=raw["Line"], station_of_line=raw["StationOfLine"],
                             station_of_route=raw["StationOfRoute"], s2s=raw["S2STravelTime"],
                             transfers=raw["LineTransfer"], exits=raw["StationExit"], frequency=raw["Frequency"],
                             updated_at=updated_at)
    errors = check_metro_index(data)
    if errors:
        raise SystemExit("快照不符合合約：\n" + "\n".join(errors[:20]))

    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for target in filter(None, [args.out, args.copy]):
        out = Path(target)
        if not out.is_absolute():
            out = ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        print(f"寫入 {out}")
    exits = sum(bool(s["exits"]) for s in data["stations"])
    print(f"路線 {len(data['lines'])}、車站 {len(data['stations'])}（有出口 {exits}）、方向 {len(data['patterns'])}、"
          f"換線 {len(data['transfers'])}；用了預設值的欄位：{data['defaults'] or '無'}")


if __name__ == "__main__":
    main()
