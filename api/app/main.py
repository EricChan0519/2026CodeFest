"""跟著箭頭走 API。

本機：cd api && uvicorn app.main:app --reload --port 8080
部署：gcloud run deploy api --source api --region asia-east1 --allow-unauthenticated --max-instances 2
路由一律 /api 開頭，配合 firebase.json 的 /api/** rewrite。
使用者座標只放 POST body，不寫進 log（ADR-0005）。
"""
import asyncio
import os
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.engine import get_engine
from app import metrics
from app.errors import ApiError, install_error_handlers
from app.geo import in_area
from app.route_rules import TPE
from app import elevation, routes_service
from app.routes_service import plan_routes
from app.places import PlaceIndex
from app.schemas import AroundRequest, NearbyRequest, PlaceSearchRequest, RoutesRequest
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

VERSION = os.environ.get("APP_VERSION") or os.environ.get("K_REVISION") or "local"


@lru_cache
def get_station_index():
    default = Path(__file__).resolve().parents[1] / "data" / "stop_index.json"
    return StationIndex.load(Path(os.environ.get("STOP_INDEX_PATH") or default))


@lru_cache
def get_place_index():
    default = Path(__file__).resolve().parents[1] / "data" / "place_index.json.gz"
    return PlaceIndex.load(Path(os.environ.get("PLACE_INDEX_PATH") or default))


@lru_cache
def get_routing_engine():
    return get_engine()


def get_measure():
    return routes_service.default_measure


def get_now():
    return datetime.now(TPE)


@app.get("/api/health")
async def health(deep: bool = False, index: StationIndex = Depends(get_station_index), engine=Depends(get_routing_engine)):
    body = {"status": "ok", "version": VERSION, "stopIndexUpdatedAt": index.updated_at}
    if not deep:
        return body
    try:
        routing = bool(await asyncio.wait_for(engine.ping(), timeout=10))
    except Exception:
        routing = False
    body["checks"] = {"routing": routing, "stopIndex": index.available, "elevation": elevation.available()}
    if not routing or not index.available:
        body["status"] = "degraded"
        return JSONResponse(body, status_code=503)
    return body


@app.post("/api/stations/nearby")
def stations_nearby(req: NearbyRequest, index: StationIndex = Depends(get_station_index)):
    return {"stations": index.nearby(req.lat, req.lon, req.radiusM), "source": index.source}


@app.get("/api/stations/search")
def stations_search(q: str = Query(max_length=50), index: StationIndex = Depends(get_station_index)):
    return {"stations": index.search(q), "source": index.source}


@app.post("/api/landmarks/search")
def landmarks_search(req: PlaceSearchRequest, index: PlaceIndex = Depends(get_place_index)):
    """地標、餐廳、學校…（不含連鎖店，連鎖店在前端的 poi_index.json）。座標只放 body、不記錄（ADR-0005）"""
    near = (req.lat, req.lon) if req.lat is not None and req.lon is not None else None
    return {"places": index.search(req.q, near, req.limit), "source": index.source}


@app.post("/api/around")
def around(req: AroundRequest):
    """某一點附近的路燈、監視器、派出所。座標只放 body、不記錄（ADR-0005）；沒有快照的部分回 null。"""
    if not in_area(req.lat, req.lon):
        raise ApiError("OUT_OF_AREA", 400)
    found = metrics.nearby(req.lat, req.lon, req.radiusM, req.policeRadiusM)
    sources = []
    if found["lamps"] is not None:
        sources.append({"name": routes_service.LAMP_SOURCE_NAME, "updatedAt": metrics.source_updated_at().get("lamps")})
    if found["cameras"] is not None or found["police"] is not None:
        sources += routes_service.safety_sources()
    return {"radiusM": req.radiusM, "policeRadiusM": req.policeRadiusM, **found, "sources": sources}


@app.post("/api/routes")
async def routes(req: RoutesRequest, engine=Depends(get_routing_engine), now: datetime = Depends(get_now), measure=Depends(get_measure)):
    return await plan_routes(req, engine, now, measure=measure)
