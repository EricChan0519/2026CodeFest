"""讀取離線站位快照並提供查詢。"""
import json
from dataclasses import dataclass, field
from pathlib import Path

from app.errors import ApiError
from app.geo import haversine_m, in_area

SOURCE_NAME = "TDX 公車站位資料"


def normalize(value: str) -> str:
    return value.strip().lower().replace("台", "臺")


@dataclass
class StationIndex:
    stations: list[dict] = field(default_factory=list)
    updated_at: str | None = None
    available: bool = False

    @classmethod
    def load(cls, path: Path) -> "StationIndex":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            stations = data["stations"]
            if not isinstance(stations, list) or not isinstance(data["updatedAt"], str):
                raise ValueError("快照格式錯誤")
            for station in stations:
                name = station["name"]
                if not isinstance(station["stationUid"], str) or not isinstance(name["zh"], str):
                    raise ValueError("快照格式錯誤")
                if name["en"] is not None and not isinstance(name["en"], str):
                    raise ValueError("快照格式錯誤")
                if not isinstance(station["lat"], (int, float)) or not isinstance(station["lon"], (int, float)) or not isinstance(station["routes"], list):
                    raise ValueError("快照格式錯誤")
                station["bearing"]
                station["_q"] = normalize(" ".join(filter(None, [name["zh"], name["en"]])))
            return cls(stations, data["updatedAt"], True)
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            return cls()

    def _require(self):
        if not self.available:
            raise ApiError("DATA_UNAVAILABLE", 503)

    @property
    def source(self):
        return {"name": SOURCE_NAME, "updatedAt": self.updated_at}

    @staticmethod
    def _public(station):
        return {k: v for k, v in station.items() if k not in {"_q", "distanceM"}}

    def nearby(self, lat, lon, radius_m):
        self._require()
        if not in_area(lat, lon):
            raise ApiError("OUT_OF_AREA", 400)
        hits = [(haversine_m((lat, lon), (s["lat"], s["lon"])), s) for s in self.stations]
        hits = sorted((d, i, s) for i, (d, s) in enumerate(hits) if d <= radius_m)
        return [{**self._public(s), "distanceM": round(d)} for d, _, s in hits]

    def search(self, q):
        self._require()
        needle = normalize(q)
        if not needle:
            raise ApiError("VALIDATION_ERROR", 422)
        return [self._public(s) for s in self.stations if needle in s["_q"]][:50]
