# 2026 臺北秋季程式設計節 · 城市通微服務大黑客松 — 專案說明（給 AI 與隊員）

比賽日：**2026/11/7–11/8（天母）**。題目當天公布。本資料夾是賽前準備好的知識庫，題目公布、brainstorm 完即可依此開工。

## 先讀這些（依序）
0. [START_HERE.md](START_HERE.md) — 隊員環境建置；賽前待辦見 [docs/11-prep-todo.md](docs/11-prep-todo.md)
1. [docs/01-competition-rules.md](docs/01-competition-rules.md) — **硬性規則與評分配分**（違反＝扣分或不能整併）
2. [docs/03-two-way-communication.md](docs/03-two-way-communication.md) — 網頁 ↔ App 溝通協定（最常寫錯）
3. [docs/10-architecture.md](docs/10-architecture.md) — 我們的系統架構（討論中）
4. [docs/12-scoring-playbook.md](docs/12-scoring-playbook.md) — **每個評分項目要靠什麼實作拿分**（選題、寫計畫、收尾都要對照）
5. 其餘見 [docs/README.md](docs/README.md)

## 不可違反的規則（摘要）
- **授權**：作品 repo 公開、採 **AGPL-3.0** + 主辦指定授權聲明；得獎後公開至少一年。套件只用 MIT / BSD / Apache-2.0 等開源免費授權。
- **地圖只能用開源**：Leaflet / MapLibre + OpenStreetMap 或國土測繪中心圖資。**禁止 Google Maps、Mapbox**（官方範例 TownPass-Services 與往屆作品用了 Google Maps/Mapbox，**不要照抄**）。
- **執行階段 AI 推論必須在裝置端**：不得呼叫雲端 LLM API / 遠端模型（評審可能關網路現場測）。開發時用雲端 AI 寫程式 OK。不得使用資安黑名單（含大陸廠牌）模型。
- **核心資料須為合法開放資料並註明出處**；非核心可用模擬資料，README 須標示。
- 部署用**免費方案**；後端附 **Dockerfile**（可移轉、可維運、可上架）。
- 發表**不用簡報**，直接投影實機操作畫面。
- 評分：初選 服務應用 40／視覺 30／技術完整度 30；決選 服務完整度（能否落地）30／服務應用 25／技術穩定度 20／視覺 15／創意公益 10。
- **作品 11/8 09:00 前上傳主辦作品系統**（實際功能凍結約 07:30）。初選評審輪桌到座位，2 分鐘＋Q&A 1 分鐘、會被 A/B 兩組各評一次；決選 15 隊、5 分鐘發表＋5 分鐘 Q&A，自帶 Demo 筆電、控台只有 HDMI。
- 隊伍 4～5 人，全員實體報到，攜帶政府核發證件。

## 技術基準（2026/10 TownPass main）
- Flutter **3.47.6**（`.fvmrc`）、Dart ≥ 3.13、iOS ≥ 15、Android AGP 9.1.0 / Kotlin 2.4.0 / Gradle 9.3.1、**Java 17**。
- App 狀態管理/路由：GetX；WebView：`flutter_inappwebview`；JS 物件名 `flutterObject`。
- 微服務前端：語言框架不限（官方範例 Vue 3 + Vite + Tailwind + Pinia）。
- AI 的 Flutter/AGP 知識可能過舊 → 回答前先看 `reference/TownPass/pubspec.yaml` 與原始碼。

## 容易踩的坑（已用原始碼／實際呼叫確認，細節見 docs）
- **Flutter 專案路徑不能有中文**：在 `…\專案資料夾\黑克松\…` 底下 `build_runner` 會報 `Unable to write file`，搬到 `C:\dev\townpass` 就正常（2026-11-05 實測）。隊伍 repo 一律放全英文路徑。
- 只有 **App 負責人（隊長）** 需要 Flutter 環境；網頁、後端更新不用重 build App（destinationUrl 指向 Hosting）。隊長的練習 build 在 `C:\dev\townpass`（11/5 已在模擬器驗證：測試服務置頂、flutterObject、deviceinfo、notify、/api/health 都正常）。
- TownPass 寫死 NDK `29.0.13113456`，Gradle 自動安裝會崩潰 → 先用 Android CLI 手動裝（見 docs/02）。JDK 25 可以 build。
- `postMessage` 的 `data` 直接放物件，**不要雙重 JSON.stringify**；`launch_map`／`phone_call` 一定傳非空字串。（03）
- Android main manifest **沒有 `INTERNET` 權限**（只有 debug／profile 有）→ release／側載 APK 要補，不然打不開網頁。（02）
- 「我的服務」置頂清單**不存檔**，App 重開就重置 → Demo 前把我們的服務加進 `pinned_service_widget_controller.dart` 的預設值。（02）
- Android 擋 http 明文 → destinationUrl、API 一律 HTTPS。（02、05）
- data.taipei API 只允許 `https://data.taipei` 跨域；TDX、氣象署要金鑰 → 這些資料**要經後端**。（07）
- 國土測繪中心圖磚路徑是 `{z}/{y}/{x}`（y 在前）。（04）
- Cloud Run 冷啟動數秒 → 上台前先打一次 API 暖機。（05）

## 已建立的雲端資源
| 資源 | 值 |
|---|---|
| Firebase / GCP 專案 ID | `townpass-hackathon-2026` |
| Firebase Console | https://console.firebase.google.com/project/townpass-hackathon-2026/overview |
| Hosting 網址（微服務前端，填進 `destinationUrl`） | https://townpass-hackathon-2026.web.app |
| gcloud 預設專案 | 已是 `townpass-hackathon-2026` |
| Cloud Run（後端） | 服務 `api`（asia-east1）：https://api-239765207532.asia-east1.run.app ；Hello `/api/health`（2026-11-04 部署） |
| Hosting 內容 | 雙向溝通測試頁＋`/api/**` rewrite 到 Cloud Run `api`；原始檔在 `prep-deploy/` |
| IAM | 已給預設 compute 服務帳號 `roles/run.builder`（`--source` 部署需要） |

## 資料夾結構
```
黑克松/
├─ CLAUDE.md                 ← 你正在讀
├─ docs/                     ← 知識庫（規則、App、溝通、部署、AI、資料、往屆、架構）
│  └─ templates/             ← 可直接複製的樣板（bridge、測試頁、Handler、FastAPI、Dockerfile、firebase.json、LICENSE、README）
└─ reference/                ← 唯讀參考原始碼（git clone --depth 1，2026/11/3 取得）
   ├─ TownPass/              ← 官方 App（Flutter）main @ e65b586 (2026-10-17)
   ├─ TownPass-Services/     ← 官方 Vue 3 微服務範例（2025-01，用 Google Maps → 勿沿用地圖）
   ├─ townpass2024-parking/  ← ParkFlow：自訂 timer_set Handler 範例
   ├─ townpass2024-weather/  ← 即時雨晴：Flask + 純 HTML + Leaflet
   └─ townpass2025-RideFlow/ ← RideFlow：README / AI 聲明寫法範本
```
`reference/` 只用來查閱；真正開發的 repo 比賽當天另建（fork TownPass + 微服務 + 後端）。
隊長的練功專案 `codefest2026`（城市水路：Vue 3 + Leaflet + Tailwind 4 + FastAPI／Spring Boot + data.taipei），技術選型與寫法可參考。

## 工作方式
- 使用 Superpowers：題目公布 → `brainstorming` → `writing-plans` → 分工實作（`subagent-driven-development` / `dispatching-parallel-agents`）。
- AI 產生的程式碼隊員必須讀過（決選有問答）。
- 每個資料集、套件、模型都要記到 README 清單（見 [docs/templates/README_TEMPLATE.md](docs/templates/README_TEMPLATE.md)）。
