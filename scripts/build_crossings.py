"""Build api/data/crossings.json from OpenStreetMap (ODbL) via Overpass."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = '[out:json][timeout:180];node["highway"="crossing"](24.96,121.45,25.21,121.67);out body;'
OUTPUT = Path(__file__).resolve().parents[1] / "api" / "data" / "crossings.json"


def classify(tags: dict) -> str:
    crossing = tags.get("crossing")
    if crossing == "traffic_signals":
        return "signal"
    if crossing in ("uncontrolled", "unmarked"):
        return "unsignalized"
    return "unknown"


def build(overpass: dict, updated_at: str) -> dict:
    out = {"updatedAt": updated_at, "signal": [], "unsignalized": [], "unknown": []}
    for element in overpass["elements"]:
        if element.get("type") == "node":
            kind = classify(element.get("tags", {}))
            out[kind].append([round(element["lat"], 5), round(element["lon"], 5)])
    return out


def main() -> None:
    response = httpx.post(
        OVERPASS_URL, data={"data": QUERY}, timeout=200, headers={"User-Agent": "arrow-nav-snapshot/1.0"}
    )
    response.raise_for_status()
    updated_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    out = build(response.json(), updated_at)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print({k: len(out[k]) for k in ("signal", "unsignalized", "unknown")})


if __name__ == "__main__":
    main()
