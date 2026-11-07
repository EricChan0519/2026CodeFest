# starter — 題目無關的微服務骨架（賽前／開賽時準備）

> 開賽後複製 `web/`、`api/` 到隊伍 repo 使用。README 要註明這些骨架是賽前準備的（規則：只能事先準備與題目無關的部分）。

## web/（Vue 3.5 + Vite 8 + TS + Tailwind 4 + Leaflet 1.9 + vue-router）
```bash
cd web && npm install && npm run dev      # http://localhost:5173，/api 自動 proxy 到 :8080
npm run build && firebase hosting:channel:deploy <名字> --expires 1d   # 預覽頻道，不要直接 deploy 正式站
```
| 檔案 | 用途 |
|---|---|
| `src/lib/townpass-bridge.ts` | flutterObject 包裝（`tp.location()`、`tp.notify()`…），瀏覽器下回 mock |
| `src/lib/api.ts` | 打 `/api/...`，含 timeout 與中文錯誤訊息 |
| `src/composables/useAsync.ts` | loading / error / data 三態 |
| `src/components/StateView.vue` | 載入中、錯誤＋重試、空資料畫面 |
| `src/components/MapView.vue` | Leaflet + 國土測繪中心 EMAP（失敗切 OSM）、circleMarker、我的位置 |
| `src/components/DataSource.vue` | 「資料來源：…，更新於 …」 |
| `src/views/HomeView.vue` | 示範頁（後端、定位、地圖、推播）→ 題目公布後替換 |
| `src/views/AboutView.vue` | 「關於這個服務」頁（取代簡報） |
| `src/style.css` | TownPass App 色票（`primary-500 = #5ab4c5`）、`shadow-card` |
| `firebase.json` | SPA + `/api/**` → Cloud Run `api` |

## api/（FastAPI，Python 3.12 容器）
```bash
cd api && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt
uvicorn main:app --reload --port 8080     # /api/health、/api/example、/docs
python opendata.py <resource_id>          # 把 data.taipei 資料存成 data/<rid>.json 當離線備份
```
| 檔案 | 用途 |
|---|---|
| `main.py` | `/api/health`、`/api/example`（data.taipei 垃圾車點位示範）、CORS |
| `opendata.py` | `fetch_taipei(rid)`：自動分頁（1000/頁）、TTL 快取、失敗退回舊快取或備份 JSON（`stale: true`） |
| `tdx.py` | `tdx_get(path)`：TDX token 取得與快取（需 `TDX_CLIENT_ID/SECRET`） |
| `Dockerfile`、`.env.example` | Cloud Run 部署、金鑰清單 |
