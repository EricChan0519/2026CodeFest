"""站位查詢（Story D2）。資料來自建置時產生的快照 api/data/stop_index.json（ADR-0004）。"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from app.errors import ApiError

# 服務範圍：臺北市（含部分新北市），與 02 的 OSM 裁切範圍相同
LAT_MIN, LAT_MAX = 24.96, 25.21
LON_MIN, LON_MAX = 121.45, 121.67
SOURCE_NAME = "TDX 公車站位資料"
SEARCH_LIMIT = 50


def in_area(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@dataclass
class StationIndex:
    stations: list[dict] = field(default_factory=list)
    updated_at: str | None = None
    available: bool = False

    @classmethod
    def load(cls, path: Path) -> "StationIndex":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls()  # 快照不存在或壞掉：查詢回 DATA_UNAVAILABLE，health 回 null
        stations = data["stations"]
        for s in stations:  # 預先算好小寫名稱，搜尋時不用每次轉換
            s["_q"] = " ".join(filter(None, [s["name"]["zh"], s["name"]["en"]])).lower()
        return cls(stations, data.get("updatedAt"), True)

    def _require(self) -> None:
        if not self.available:
            raise ApiError("DATA_UNAVAILABLE", 503)

    @property
    def source(self) -> dict:
        return {"name": SOURCE_NAME, "updatedAt": self.updated_at}

    @staticmethod
    def _public(s: dict) -> dict:
        return {k: v for k, v in s.items() if k != "_q"}

    def nearby(self, lat: float, lon: float, radius_m: int) -> list[dict]:
        self._require()
        if not in_area(lat, lon):
            raise ApiError("OUT_OF_AREA", 400)
        hits = []
        for s in self.stations:
            d = haversine_m(lat, lon, s["lat"], s["lon"])
            if d <= radius_m:
                hits.append((d, s))
        hits.sort(key=lambda h: h[0])
        return [{**self._public(s), "distanceM": round(d)} for d, s in hits]

    def search(self, q: str) -> list[dict]:
        self._require()
        needle = q.strip().lower()
        return [self._public(s) for s in self.stations if needle in s["_q"]][:SEARCH_LIMIT]
