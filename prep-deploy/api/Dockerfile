# FastAPI → Cloud Run（gcloud run deploy api --source . --region asia-east1）
# 需要 requirements.txt（含 fastapi、uvicorn），入口 main.py 內 app = FastAPI()
# CORS：from fastapi.middleware.cors import CORSMiddleware
#   app.add_middleware(CORSMiddleware, allow_origins=["https://<project>.web.app", "http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
