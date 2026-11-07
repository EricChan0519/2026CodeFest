"""微服務後端骨架（與題目無關）。

本機：uvicorn main:app --reload --port 8080
部署：gcloud run deploy api --source . --region asia-east1 --allow-unauthenticated
路由一律 /api 開頭，配合 firebase.json 的 /api/** rewrite。
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from opendata import fetch_taipei

app = FastAPI(title="TownPass microservice API")

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


@app.get("/api/health")
def health():
    return {"ok": True, "revision": os.environ.get("K_REVISION", "local")}


# ---- 範例：data.taipei 代理＋快取（題目公布後換成真正的資料集） ----
# 垃圾車點位路線 https://data.taipei/dataset/detail?id=… resource_id 見 docs/07
GARBAGE_RID = "a6e90031-7ec4-4089-afb5-361a4efe7202"


@app.get("/api/example")
async def example(limit: int = 20):
    ds = await fetch_taipei(GARBAGE_RID, max_rows=limit)
    return {
        "source": {"name": "臺北市資料大平臺", "url": "https://data.taipei"},
        "updatedAt": ds.fetched_at,
        "stale": ds.stale,
        "items": ds.rows[:limit],
    }
