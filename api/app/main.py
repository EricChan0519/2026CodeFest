"""跟著箭頭走 API。

本機：cd api && uvicorn app.main:app --reload --port 8080
部署：gcloud run deploy api --source api --region asia-east1 --allow-unauthenticated --max-instances 2
路由一律 /api 開頭，配合 firebase.json 的 /api/** rewrite。
使用者座標只放 POST body，不寫進 log（ADR-0005）。
"""
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.errors import ApiError, install_error_handlers
from app.schemas import NearbyRequest
from app.stations import StationIndex

app = FastAPI(title="Arrow Nav API")
install_error_handlers(app)

# 走 Hosting rewrite 是同網域、不需 CORS；直接打 run.app 網址或本機時才用得到
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://townpass-hackathon-2026.web.app",
        "https://townpass-hackathon-2026.firebaseapp.com",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"https://townpass-hackathon-2026--[\w-]+\.web\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)

VERSION = os.environ.get("APP_VERSION") or os.environ.get("K_REVISION", "local")


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@lru_cache
def get_station_index() -> StationIndex:
    return StationIndex.load(Path(os.environ.get("STOP_INDEX_PATH", DATA_DIR / "stop_index.json")))


Index = Annotated[StationIndex, Depends(get_station_index)]


@app.get("/api/health")
def health(idx: Index):
    return {"status": "ok", "version": VERSION, "stopIndexUpdatedAt": idx.updated_at}


@app.post("/api/stations/nearby")
def stations_nearby(req: NearbyRequest, idx: Index):
    return {"stations": idx.nearby(req.lat, req.lon, req.radiusM), "source": idx.source}


@app.get("/api/stations/search")
def stations_search(idx: Index, q: Annotated[str, Query(max_length=50)]):
    if not q.strip():
        raise ApiError("VALIDATION_ERROR", 422)
    return {"stations": idx.search(q), "source": idx.source}
