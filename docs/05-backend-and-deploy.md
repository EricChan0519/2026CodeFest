# 05 · 後端與部署

| 元件 | 推薦 | 替代（須免費、HTTPS） |
|---|---|---|
| 微服務網頁（靜態） | **Firebase Hosting** → `https://townpass-hackathon-2026.web.app` | GitHub Pages、Cloudflare Pages、Vercel |
| 後端 API（選配） | **Cloud Run**（容器、按請求計費、閒置不收費）region **asia-east1**（彰化） | Render、Fly.io、比賽期間 ngrok |

後端語言不限（往屆：FastAPI、Flask；講義範例 Spring Boot）。**準備 Dockerfile** = 可移轉/可維運/可上架。

## 我們的雲端現況（2026-11-04）
- 專案 `townpass-hackathon-2026`：帳單已綁 ✅、gcloud 預設專案已切過來 ✅。
- Hosting：雙向溝通測試頁 + `/api/**` rewrite ✅；Cloud Run `api`（asia-east1）Hello ✅ → https://api-239765207532.asia-east1.run.app 。原始檔在 `prep-deploy/web`、`prep-deploy/api`。
- ⚠️ 新專案第一次 `--source` 部署會因「預設服務帳號缺 IAM 權限」失敗 → 已給 `239765207532-compute@developer.gserviceaccount.com` 加 `roles/run.builder`。
- ⚠️ 正式 repo 部署時 `firebase deploy` 會**覆蓋**這個測試頁；想保留就把測試頁放到正式網頁的 `/bridge-test/` 路徑。

## Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # 選既有專案 townpass-hackathon-2026 | public: dist（Vite）| single-page app: Yes | 覆蓋 index.html: No
npm run build
firebase deploy --only hosting
```
→ 網址填 `my_service_model.dart` 的 `destinationUrl` → `flutter run` → App 內開啟確認雙向溝通。

### Preview channel（每個人各自部署、不蓋掉正式版）
```bash
firebase hosting:channel:deploy alice --expires 7d
```
→ 得到 `https://townpass-hackathon-2026--alice-xxxx.web.app`（HTTPS）。隊友要先被加進 Firebase 專案成員才能部署。

### 用 Hosting 轉發 API（可免掉 CORS）
同一個 GCP 專案的 Cloud Run 可以掛在 Hosting 底下，網頁直接打 `/api/...`，同網域就沒有 CORS 問題：
```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "/api/**", "run": { "serviceId": "api", "region": "asia-east1" } },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```
- `/api/**` 那條要放在 SPA 的 `**` 前面。後端路由要真的以 `/api` 開頭。
- 不用 rewrite 的話：後端開 CORS，允許 `https://townpass-hackathon-2026.web.app`、preview channel 網域（`https://townpass-hackathon-2026--*.web.app`）與 `http://localhost:5173`。

## Cloud Run
```bash
gcloud config set project townpass-hackathon-2026
gcloud run deploy api --source . --region asia-east1 --allow-unauthenticated
# 第一次會問：啟用 API → y
# → https://api-xxxx.asia-east1.run.app
```
- `--source`：Cloud Build 建容器（有 Dockerfile 用它，沒有用 buildpacks）→ 推 Artifact Registry。
- **Container Registry (gcr.io) 已於 2025/3 關閉**，往屆 `docker build -t gcr.io/...` 不能用，改 `*.pkg.dev`。
- 服務必須監聽環境變數 **`PORT`**（預設 8080）。
- **CORS**：網頁在 web.app、API 在 run.app 不同網域 → 後端要開 CORS（或用上面的 Hosting rewrite）。
- 環境變數：`gcloud run deploy ... --set-env-vars TDX_CLIENT_ID=...,TDX_CLIENT_SECRET=...`；金鑰不要進 repo，README 提供 `.env.example`。

### 免費額度與費用（以官方定價頁為準）
- Cloud Run（依請求計費）每月免費約 **180,000 vCPU-秒、360,000 GiB-秒、200 萬次請求**，按帳單帳戶合計。比賽流量遠低於此。
- 預設 `min-instances=0` → 閒置不收費，但**第一次請求有冷啟動（數秒）**。**上台前先打一次 API 暖機**；不要為了這個開 `min-instances=1`（會一直計費）。
- Artifact Registry 每次 deploy 都會存一份映像，免費 0.5 GB；比賽後刪舊映像，或設定清理政策。
- Cloud Build 的暫存會放在 `gs://townpass-hackathon-2026_cloudbuild`。
- 建議在 GCP 帳單設**預算警示**。

### 資料要存哪裡（免費方案）
| 需求 | 建議 | 備註 |
|---|---|---|
| 只讀開放資料 | 後端啟動時抓＋記憶體快取（定時刷新），或 build 時轉成 JSON 放 Hosting | 最簡單，無 DB |
| 需要寫入（回報、收藏、排行榜） | SQLite（容器內）只適合 Demo：**Cloud Run 重啟或擴容就會遺失**，且多個 instance 不共享 | Demo 可加 `--max-instances=1` 降低不一致 |
| 要持久化 | Firestore（Firebase 免費額度）或外部免費 Postgres | 整併時資訊局要能接手 → 用 ORM／Repository 抽象，README 寫清楚換 DB 的方式 |
- 練功專案 `codefest2026` 用 PostgreSQL + docker-compose：本機開發 OK，但 Cloud SQL 不在免費額度內，**不要直接搬上 Cloud SQL**。

## 開發迭代：讓手機上的 App 打開筆電上的網頁
Android 擋 http 明文、`flutterObject` 只在 App 的 WebView 裡 → 手機一定要開 **HTTPS 網址**。三種做法：
| 做法 | 指令 | 適合 |
|---|---|---|
| Preview channel | `npm run build && firebase hosting:channel:deploy <名字>` | 最穩，每次約 1 分鐘 |
| Tunnel（熱更新） | `cloudflared tunnel --url http://localhost:5173`（免帳號，得到 `*.trycloudflare.com`；cloudflared 為 Apache-2.0）或 ngrok | 改 code 手機立即看到；Vite 要設 `server.allowedHosts` |
| 正式站 | `firebase deploy --only hosting` | 整合測試、Demo |
- 搭配 [templates/bridge-test/index.html](templates/bridge-test/index.html) 的「前往網址」：App 的 destinationUrl 固定指向測試頁，要測哪個網址就貼上跳過去，**不用每次改 App 重 build**。

## 串回城市通
1. destinationUrl 改正式網址 2. `flutter run` 裝實機（定位/掃碼/通知要實機）3. 服務 › 更多 › 加入（或直接改預設置頂，見 [02](02-townpass-app.md)）4. 完整走一次：開 App → 找到服務 → 完成操作 → 回首頁（= Demo 流程）

## 帳號（賽前完成）
Firebase、GCP（✅ 已建、已綁帳單）、**TDX（金鑰要提早申請）**、中央氣象署 opendata（若用天氣）。
