"""從 TDX 公車資料產生站位快照 api/data/stop_index.json（Story D1）。

用法（金鑰只放環境變數，不寫進檔案）：
  TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... python scripts/build_stop_index.py

站位 = 同一個 StationID 的站牌。同名不同 StationID（不同方向）各自一筆。
只能下車（StopBoarding = -1）的路線不列；沒有可上車路線的站位也不列。
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "api" / "data" / "stop_index.json"
TPE = timezone(timedelta(hours=8))


def _s(v) -> str | None:
    """TDX 缺值可能是缺欄位、None 或空字串，一律轉成 None。"""
    return v.strip() if isinstance(v, str) and v.strip() else None


def _headsign(route: dict | None, direction: int) -> dict:
    # 去程往終點、返程往起點；迴圈與循環路線用終點；未知方向不顯示
    if route is None or direction == 255:
        return {"zh": None, "en": None}
    key = "Departure" if direction == 1 else "Destination"
    zh, en = _s(route.get(f"{key}StopNameZh")), _s(route.get(f"{key}StopNameEn"))
    return {"zh": f"往{zh}" if zh else None, "en": f"To {en}" if en else None}


def build_index(stop_of_route: list, stops: list, routes: list, updated_at: str) -> dict:
    bearing = {s["StopUID"]: _s(s.get("Bearing")) for s in stops}
    route_by_uid = {r["RouteUID"]: r for r in routes}
    stations: dict[str, dict] = {}
    seen: set[tuple[str, str, int]] = set()  # (station, route, direction)：子路線重複時只留一筆

    for sor in stop_of_route:
        direction = sor.get("Direction", 255)
        name = sor.get("RouteName") or {}
        for stop in sor.get("Stops", []):
            if stop.get("StopBoarding") == -1:
                continue
            sid = stop["StationID"]
            key = (sid, sor["RouteUID"], direction)
            if key in seen:
                continue
            seen.add(key)
            st = stations.get(sid)
            if st is None:
                pos, sname = stop.get("StopPosition") or {}, stop.get("StopName") or {}
                st = stations[sid] = {
                    "stationUid": f"TPE{sid}",
                    "name": {"zh": _s(sname.get("Zh_tw")), "en": _s(sname.get("En"))},
                    "bearing": bearing.get(stop["StopUID"]),
                    "lat": pos.get("PositionLat"),
                    "lon": pos.get("PositionLon"),
                    "routes": [],
                }
            st["routes"].append({
                "routeName": {"zh": _s(name.get("Zh_tw")), "en": _s(name.get("En"))},
                "direction": direction,
                "headsign": _headsign(route_by_uid.get(sor["RouteUID"]), direction),
                "stopUid": stop["StopUID"],
            })

    return {"updatedAt": updated_at, "stations": list(stations.values())}


async def _download():
    from tdx import tdx_get

    q = {"$format": "JSON"}
    return await asyncio.gather(
        tdx_get("/v2/Bus/StopOfRoute/City/Taipei", q),
        tdx_get("/v2/Bus/Stop/City/Taipei", q),
        tdx_get("/v2/Bus/Route/City/Taipei", q),
    )


def main() -> None:
    sor, stops, routes = asyncio.run(_download())
    now = datetime.now(TPE).isoformat(timespec="seconds")
    index = build_index(sor, stops, routes, now)
    OUT.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = len(index["stations"])
    en = sum(1 for s in index["stations"] if s["name"]["en"])
    print(f"stations: {n}, with English name: {en} ({en / max(n, 1):.1%}) -> {OUT}")


if __name__ == "__main__":
    main()
