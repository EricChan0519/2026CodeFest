"""開放資料抓取工具：分頁、記憶體快取（TTL）、失敗時退回本機備份 JSON。

- data.taipei 單次 limit 上限 1000，用 offset 分頁。
- 抓不到時：有舊快取用舊快取；沒有就讀 data/<resource_id>.json（stale=True）。
  → Demo 時網路掛掉也不會整個服務掛（評分：技術穩定度）。
- 執行 `python opendata.py <resource_id>` 可把目前資料存成備份 JSON。
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).parent / "data"
TAIPEI_API = "https://data.taipei/api/v1/dataset/{rid}?scope=resourceAquire&limit={limit}&offset={offset}"
PAGE = 1000


@dataclass
class Dataset:
    rows: list[dict]
    fetched_at: str
    stale: bool = False
    _ts: float = field(default=0.0, repr=False)


_cache: dict[str, Dataset] = {}
_locks: dict[str, asyncio.Lock] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _fetch_all(rid: str, max_rows: int | None) -> list[dict]:
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=15) as client:
        offset = 0
        while True:
            r = await client.get(TAIPEI_API.format(rid=rid, limit=PAGE, offset=offset))
            r.raise_for_status()
            result = r.json()["result"]
            batch = result["results"]
            rows.extend(batch)
            offset += len(batch)
            if not batch or offset >= result["count"] or (max_rows and len(rows) >= max_rows):
                break
    return rows


async def fetch_taipei(rid: str, ttl: int = 600, max_rows: int | None = None) -> Dataset:
    """取 data.taipei 資料集。ttl 秒內重用快取。"""
    hit = _cache.get(rid)
    if hit and not hit.stale and time.time() - hit._ts < ttl:
        return hit
    lock = _locks.setdefault(rid, asyncio.Lock())
    async with lock:
        hit = _cache.get(rid)
        if hit and not hit.stale and time.time() - hit._ts < ttl:
            return hit
        try:
            rows = await _fetch_all(rid, max_rows)
            ds = Dataset(rows=rows, fetched_at=_now(), _ts=time.time())
        except Exception:
            if hit:
                hit.stale = True
                return hit
            backup = DATA_DIR / f"{rid}.json"
            if not backup.exists():
                raise
            saved = json.loads(backup.read_text(encoding="utf-8"))
            ds = Dataset(rows=saved["rows"], fetched_at=saved["fetched_at"], stale=True, _ts=time.time())
        _cache[rid] = ds
        return ds


def to_float(v) -> float | None:
    """開放資料的經緯度常是字串，空字串回 None。"""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    rid = sys.argv[1]
    data = asyncio.run(_fetch_all(rid, None))
    DATA_DIR.mkdir(exist_ok=True)
    out = DATA_DIR / f"{rid}.json"
    out.write_text(json.dumps({"fetched_at": _now(), "rows": data}, ensure_ascii=False), encoding="utf-8")
    print(f"saved {len(data)} rows -> {out}")
