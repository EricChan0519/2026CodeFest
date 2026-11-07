# FastAPI Hello World（賽前準備用，與題目無關）
# 本機：pip install -r requirements.txt && uvicorn main:app --reload --port 8080
# 部署：gcloud run deploy api --source . --region asia-east1 --allow-unauthenticated
#      （同資料夾放 ../Dockerfile.fastapi 改名成 Dockerfile）
# 路由都以 /api 開頭，才能配合 firebase.json 的 /api/** rewrite。
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="TownPass microservice API")

# 走 Hosting rewrite 時是同網域，不需要 CORS；直接打 run.app 網址時才用得到
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://townpass-hackathon-2026.web.app",
        "https://townpass-hackathon-2026.firebaseapp.com",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"https://townpass-hackathon-2026--[\w-]+\.web\.app",  # preview channel
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "revision": os.environ.get("K_REVISION", "local")}
