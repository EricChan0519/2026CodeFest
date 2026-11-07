# 10 · 我們的系統架構（草案，討論中）

> 狀態：**題目未公布**。這裡先定「與題目無關」的骨架；題目公布後補上「題目相關」章節。決策紀錄寫在最下方。

## 系統總覽（預設）
```
┌──────────── 城市通 App（fork TownPass, Flutter 3.47.6）────────────┐
│ 服務頁 MyServiceItem → TPWebView(destinationUrl)                     │
│ 內建 Handler：userinfo / location / notify / qr_code_scan / …       │
│ 自訂 Handler（視需要）：例 timer_set、llm_ask、nfc …                 │
└──────────────▲───────────── flutterObject (JSON {name,data}) ───────┘
               │
┌──────────────┴──── 微服務網頁 web/（Firebase Hosting, HTTPS）───────┐
│ bridge.ts（含瀏覽器 mock）· 頁面/元件 · 開源地圖 Leaflet/MapLibre      │
└──────────────┬───────────── HTTPS + CORS ───────────────────────────┘
               ▼
┌──────── 後端 api/（Cloud Run asia-east1, Docker）—— 選配 ────────────┐
│ 開放資料抓取/快取/清洗 · 業務邏輯 · (選)DB                            │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
        data.taipei / data.gov.tw / TDX / 氣象署 …
```

## 預設 repo 結構（單一公開 monorepo，方便繳交與整併）
```
<team-repo>/
├─ LICENSE                 AGPL-3.0 + 主辦授權聲明
├─ README.md               依 templates/README_TEMPLATE.md
├─ CLAUDE.md               從本資料夾搬過去並更新
├─ app/                    TownPass fork（只改：my_service_model、預設置頂、svg、自訂 handler、權限含 INTERNET；保留原 GPL-3.0 LICENSE）
├─ web/                    微服務前端（firebase.json 放這裡，含 /api rewrite）
├─ api/                    後端（若需要）+ Dockerfile + .env.example
└─ docs/                   架構圖、資料來源、API 契約
```

## 待決定（題目無關，可先討論）
| # | 問題 | 選項 | 傾向 |
|---|---|---|---|
| D1 | 前端框架 | Vue 3（官方範例、可抄 composables/UI）／React／純 HTML | ✅ **定案：Vue 3 + Vite + TS + Tailwind 4**（2026-11-05） |
| D2 | 後端語言 | FastAPI（往屆主流、資料處理方便）／Spring Boot（講義範例、須知建議技能）／Node | ✅ **定案：FastAPI**（2026-11-05） |
| D3 | 是否一定要後端 | 純前端直接打開放資料（CORS/金鑰問題）／後端代理快取 | **幾乎一定要**：data.taipei API 擋跨域、TDX／氣象署要金鑰（11/4 實測，見 07） |
| D4 | repo 型態 | monorepo ／ TownPass fork + 微服務分 repo | monorepo |
| D5 | 地圖 | Leaflet（簡單）／MapLibre（向量、好看） | ✅ **定案：Leaflet + 國土測繪中心 EMAP 圖磚**，OSM 備援（2026-11-05） |
| D10 | App 端 | — | ✅ **定案：Flutter**（TownPass fork：加服務、預設置頂、自訂 Handler、裝置端 AI、打包 APK）；微服務畫面用網頁寫，不用 Flutter（2026-11-05） |
| D6 | 裝置端 AI | 不做／做（flutter_edge_ai + Gemma 4 E2B） | 依題目；先確認隊上手機規格 |
| D7 | 分工 | App/前端/後端/資料/Demo | 待討論 |
| D8 | API 跨域 | 後端開 CORS ／ Hosting rewrite `/api/**` → Cloud Run | **傾向 Hosting rewrite**：同網域免 CORS，前端只寫 `/api/...`（見 05） |
| D9 | 資料儲存 | 無 DB（記憶體快取）／SQLite／Firestore／外部 Postgres | 依題目：只讀用快取；要寫入再討論（Cloud Run 上 SQLite 會遺失，見 05） |

## 題目相關（題目公布後填）
- 一句話需求：
- 目標使用者與情境：
- 核心開放資料（名稱 + 連結，已確認可存取）：
- 主流程（≤ 4 步）：
- Bridge 訊息清單（name / data / reply）：
- API 契約（method path → response）：
- 六面向說法：

## 決策紀錄
（日期 · 決策 · 理由）
- 2026-11-04 · 雲端統一用 GCP 專案 `townpass-hackathon-2026`（Hosting + Cloud Run asia-east1），帳單已綁 · 講義推薦、免費額度足夠
- 2026-11-04 · D1／D2／D3／D5／D8 先寫「傾向」，**等隊伍確認**才算定案
- 2026-11-05 · 定案：前端 Vue 3、後端 FastAPI、地圖 Leaflet + 國土測繪中心、App 端 Flutter · 練功專案用過、講義架構是「網頁微服務＋Flutter App」
