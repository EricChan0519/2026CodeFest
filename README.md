# 一箭成行（城市通微服務）

> 看不懂地圖也能走到：搜尋要去的地方（公車站牌也可以），跟著一支依路線轉彎的箭頭走過去。

2026 臺北秋季程式設計節 · 城市通微服務大黑客松 參賽作品。

- 正式網址（城市通 `destinationUrl`）：https://townpass-hackathon-2026.web.app/
- 後端健康檢查：https://townpass-hackathon-2026.web.app/api/health
- 本 repo 包含全部原始碼：微服務前端、後端、步行路網、資料建置腳本、文件，以及修改後的城市通 App（[app/](app/)）
- App：[taipei-doit/TownPass](https://github.com/taipei-doit/TownPass)（main @ `c8e5d4d`）的修改版，新增服務入口與 `speak`／`haptic` Handler

## 1. 專案簡介

| 對象 | 情境 | 目前的困難 |
|---|---|---|
| 長者 | 去醫院、區公所，或到陌生地方後要搭公車回家 | 看不懂地圖方向，分不清站牌在馬路哪一側，怕階梯和陡坡 |
| 兒童 | 第一次自己走到站牌 | 看不懂地圖，常用字以外的句子也不一定看得懂 |
| 外籍人士 | 知道要搭哪一路，看不懂中文站名 | 同名站牌有好幾個，分不出方向 |

核心功能：

1. **去哪裡都可以，公車站會分方向**：搜尋任何地點；選公車站時，依路線和方向指向正確的站位，同名站位分開列。
2. **不用看地圖**：導航畫面只有站名、箭頭、距離和一句話；箭頭依路線轉彎，加上語音和震動。
3. **路線配合使用者**：長者選坡度低的路（內政部 DTM）；兒童與夜間選監視器、派出所、路燈、便利商店較多的路；繞路有上限，並說明原因。
4. **多語、分齡**：繁中、英、泰、越、印尼、日、韓；依長者、兒童、一般使用者調整字級、語速和句子。

## 2. 系統架構

```
城市通 App（TownPass, Flutter）
  └─ WebView 載入 https://townpass-hackathon-2026.web.app/   ← Firebase Hosting（web/，Vue 3）
        │  flutterObject：location、speak、haptic
        └─ /api/**  → Hosting rewrite → Cloud Run「api」（api/，FastAPI）
                                          └─ Cloud Run「routing」（routing/，Valhalla + OSM，私有）
開放資料 ── scripts/ 離線建成快照 ──> api/data/、web/public/lab/（執行時不呼叫外部資料 API、不需金鑰）
```

| 目錄 | 內容 |
|---|---|
| [app/](app/) | 城市通 App（TownPass 修改版，Flutter），保留原本的 GPL-3.0 [LICENSE](app/LICENSE) |
| [web/](web/) | 微服務前端（Vue 3） |
| [api/](api/) | 後端（FastAPI），附 Dockerfile |
| [routing/](routing/) | 步行路網（Valhalla + OSM），附 Dockerfile |
| [scripts/](scripts/) | 開放資料快照建置腳本 |
| [docs/arrow-nav/](docs/arrow-nav/) | 產品規格、合約、導航邏輯、資料限制、Demo 腳本 |

| 類別 | 技術 / 版本 | 備註 |
|---|---|---|
| App | TownPass（Flutter 3.47.6） | 新增服務入口與 `speak`、`haptic` Handler，在 `app/lib/` |
| 前端 | Vue 3.5 + Vite 8 + TypeScript + Tailwind CSS 4 | Firebase Hosting（免費方案） |
| 後端 | Python 3.12 + FastAPI | Cloud Run asia-east1（免費額度），附 Dockerfile |
| 步行路網 | Valhalla 3.9.1 + OpenStreetMap | Cloud Run，路網在建置映像時烘進去，附 Dockerfile |
| 地圖 | Leaflet 1.9 + 內政部國土測繪中心 EMAP（失敗改 OpenStreetMap） | 只在除錯頁使用；**未使用 Google Maps / Mapbox** |

### App ↔ 網頁訊息（`flutterObject`）

| name | 網頁送出 `data` | App 回覆 | 位置（`app/` 內） |
|---|---|---|---|
| `location` | — | 位置物件（TownPass 內建） | 內建 |
| `speak` | `{ text, lang, rate: 'slow'\|'normal', interrupt }` | `{ ok: true }` 或 `{ ok: false, code: 'no_voice'\|'tts_error' }` | `lib/util/web_message_handler/arrow_nav_message_handler.dart` |
| `haptic` | `{ pattern: 'turn'\|'arrive'\|'warn' }` | 不回覆 | 同上（在城市通內網頁改送此訊息；一般瀏覽器用 `navigator.vibrate`） |

朝向與持續定位用網頁標準 API（`deviceorientationabsolute`／`webkitCompassHeading`、`watchPosition`），不需另寫原生程式。
iOS 的方向權限由 App 的 `TPWebView.onPermissionRequest` 放行（只限本服務網域）。
完整合約：[docs/arrow-nav/03-contracts.md](docs/arrow-nav/03-contracts.md)。

## 3. 安裝與執行

### App

```bash
cd app
fvm install && fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
# iOS：cd ios && pod install；用 Xcode 開 ios/Runner.xcworkspace，Signing 選自己的 Team 後 Run
fvm flutter run
```

打開 App →「服務」頁 →「我的服務」第一個就是「一箭成行」（熱門區也有）。

### 前端

```bash
cd web
npm ci
npm run dev            # http://localhost:5173（/api 代理到 Cloud Run，見 vite.config.ts）
npm run build && npx firebase-tools deploy --only hosting --project townpass-hackathon-2026
```

`VITE_API_MOCK=1 npm run dev` 會改用 `src/mocks/` 的假資料（只供離線開發，正式版不使用）。

### 後端

```bash
cd api
docker build -t api . && docker run --rm -p 8080:8080 api
curl localhost:8080/api/health
# 部署
gcloud run deploy api --source . --region asia-east1 \
  --set-env-vars ROUTING_ENGINE=valhalla,ROUTING_URL=<routing 服務網址>,ROUTING_AUTH=iam
```

測試：`pip install -r requirements-dev.txt && pytest`。

### 步行路網

見 [routing/README.md](routing/README.md)。

### 環境變數

| 變數 | 用在 | 說明 |
|---|---|---|
| `ROUTING_ENGINE` | api | `valhalla`（正式）或 `fake`（本機測試，預設） |
| `ROUTING_URL` | api | routing 服務網址 |
| `ROUTING_AUTH` | api | `iam` 時向 metadata server 取 ID token 呼叫私有的 routing |
| `OSM_UPDATED_AT` | api | 顯示在出處的 OSM 路網日期 |
| `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` | scripts | **只有重建公車／捷運快照時需要**；向 [TDX](https://tdx.transportdata.tw/) 免費申請，不放進 repo |

## 4. 資料來源

核心資料皆為合法開放資料，在建置時轉成快照放進 repo（`api/data/`、`web/public/lab/`），由 `scripts/` 重建。

| 資料集 | 提供者 | 連結 | 用途 | 授權 |
|---|---|---|---|---|
| 臺北市公車站位、路線、站序、時刻 | 交通部 TDX 運輸資料流通服務 | https://tdx.transportdata.tw/ | 公車站搜尋、依方向分站位、轉乘規劃 | 政府資料開放授權條款第 1 版 |
| 臺北捷運、新北捷運環狀線車站與路線 | 交通部 TDX | https://tdx.transportdata.tw/ | 捷運轉乘規劃 | 政府資料開放授權條款第 1 版 |
| OpenStreetMap 道路與行人路網、行人穿越道 | OpenStreetMap contributors | https://www.openstreetmap.org/ | 步行路線（Valhalla）、過馬路判斷 | ODbL 1.0 |
| 內政部 20 公尺網格數值地形模型（臺北市） | 內政部 | https://data.gov.tw/dataset/35430 | 長者模式的坡度 | 政府資料開放授權條款第 1 版 |
| 臺北市路燈位置分布圖 | 臺北市政府工務局公園路燈工程管理處 | https://tppkl.blob.core.windows.net/blobfs/TaipeiLight.json | 安全模式（夜間照明） | 政府資料開放授權條款第 1 版 |
| 臺北市政府警察局錄影監視系統設置區位 | 臺北市政府警察局 | https://data.gov.tw/dataset/130094 | 安全模式 | 政府資料開放授權條款第 1 版 |
| 臺北市政府警察局名稱及地址 | 臺北市政府警察局 | https://data.gov.tw/dataset/130095 | 安全模式（附近派出所） | 政府資料開放授權條款第 1 版 |
| Overture Maps Places（2026-10-21.0） | Overture Maps Foundation | https://overturemaps.org/ | 地點搜尋、連鎖店、店面密度 | CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0 |
| Overture Maps Addresses | Overture Maps Foundation | https://overturemaps.org/ | 監視器、派出所地址轉座標（建置時一次） | CDLA-Permissive-2.0 |
| 國土測繪中心電子地圖 EMAP | 內政部國土測繪中心 | https://maps.nlsc.gov.tw/ | 除錯頁底圖 | 政府資料開放授權條款第 1 版 |
| Unicode Unihan Database | Unicode, Inc. | https://www.unicode.org/charts/unihan.html | 外語輸入地名轉回中文（拼音、韓文漢字音、漢越音） | Unicode License v3 |
| OpenCC 字典 | BYVoid | https://github.com/BYVoid/OpenCC | 簡繁、日文新字體轉換 | Apache-2.0 |

**模擬或估計的部分（非核心）：**

| 項目 | 說明 |
|---|---|
| 地點詞彙表 `api/data/place_glossary.json` | 人工整理的種類詞與地名 7 語對照，AGPL-3.0 |
| 公車搭乘時間 | 依站數估計，**不是即時到站資料** |
| `?demo=1`／除錯面板的模擬 GPS | 位置由畫面上的搖桿模擬（評審在室內也能看導航），朝向用真實羅盤；目的地前會標示「模擬」。選完路線後底部自動出現收合的小地圖（前方朝上）與搖桿，不擋導航畫面 |
| `web/src/mocks/`、`api/app/adapters/fake.py` | 只供離線開發與測試，正式版不使用 |

資料品質限制（例如少數地點座標不準、可能已歇業）寫在 [docs/arrow-nav/08-poi-data.md](docs/arrow-nav/08-poi-data.md)。

## 5. 第三方套件與授權

| 套件 | 版本 | 授權 | 用途 |
|---|---|---|---|
| flutter_tts | 4.2.5 | MIT | App 語音提示（裝置端 TTS） |
| Vue | 3.5 | MIT | 前端框架 |
| Vue Router | 5 | MIT | 前端路由 |
| Pinia | 4 | MIT | 前端狀態 |
| Leaflet | 1.9 | BSD-2-Clause | 除錯頁地圖 |
| Tailwind CSS | 4 | MIT | 樣式 |
| Vite / Vitest | 8 / 5 | MIT | 建置、測試 |
| TypeScript | 6 | Apache-2.0 | 型別 |
| FastAPI | 0.141 | MIT | 後端 |
| Uvicorn | 0.53 | BSD-3-Clause | 後端伺服器 |
| HTTPX | 0.28 | BSD-3-Clause | 後端呼叫 routing |
| Valhalla | 3.9.1 | MIT | 步行路線引擎 |
| osmium-tool | — | GPL-3.0（只在建置映像時執行） | 裁切 OSM |
| pyproj | 3.8 | MIT | 座標轉換（建置腳本） |
| DuckDB | 2.0 | MIT | 讀 Overture 資料（建置腳本） |
| pytest | 8.4 | MIT | 測試 |
| TownPass 城市通 | main @ c8e5d4d | GPL-3.0 | App 本體 |

全部為開源、免費授權，沒有授權費、訂閱費或商用模組。App 圖示 `app/assets/svg/icon_arrow_nav.svg`為本隊原創（AGPL-3.0）。

## 6. 資料安全與個資

- **使用者位置不放在網址**：座標一律放在 POST body，Cloud Run 請求紀錄只會留下路徑。
- **後端不記錄使用者資料**：log 只記錯誤類型，不記座標、搜尋字或回應內容；後端沒有資料庫，不存任何使用者資料。
- **不使用 `userinfo`**：本服務不讀取市民帳號資料（姓名、身分證字號、電話）。
- **手機只存偏好**：localStorage 只有語言、年紀、路線模式三個設定，`?reset` 可清除。
- **自訂 Handler 檢查來源**：`speak`、`haptic` 與 iOS 方向權限只回應本服務網域（正式站與 Firebase 預覽頻道），其他網頁開在城市通裡也用不到；`speak` 限制語言白名單與字數上限。
- **CORS 白名單**：後端只允許本服務網域。
- **金鑰不進 repo**：TDX 金鑰只在重建資料時從環境變數讀，執行時不需要任何金鑰；`.gitignore` 排除 `.env`、憑證檔。
- **routing 服務私有**：匿名存取回 403，只有 api 的服務帳號能呼叫。

## 7. 六面向說明

- **安全**：見上節；位置不出網址、不進 log、不存。
- **創新**：把地圖換成一支會轉彎的箭頭；路線依長者、兒童選坡度與照明。
- **有感**：解決「看不懂地圖、分不清站牌在哪一側」這個長者與外籍人士最常見的困難。
- **參與**：多語與分齡讓原本不用台北通的人也能用。
- **便利**：從城市通「我的服務」一鍵進入，之後跳過設定直接搜尋。
- **透明**：每條路線說明為什麼這樣走、繞了多少；資料出處與版本標在畫面與本文件。
- **營運接手**：資料快照由 `scripts/` 重建（建議每月一次，或 TDX 站位異動時）；前端、後端各自用 Docker／Firebase 部署，不需改 App。

## 8. AI 使用聲明

### 開發階段

| 工具 | 用途 |
|---|---|
| Claude（Anthropic）／Claude Code | 規劃、撰寫與審查程式碼、整理文件 |

人工驗證方式：所有 AI 產生的程式碼由隊員閱讀；後端與前端有自動測試（`pytest`、`vitest`）；導航在實機戶外走過真實路線驗證。

### 執行階段

**不使用任何 AI 模型**（無雲端 LLM、無裝置端模型）。外語地名翻譯、路線說明全部用規則與開放資料完成（`api/app/translate.py`），語音用手機系統內建的 TTS。

## 9. 賽前準備的部分

依競賽規則，賽前只準備與題目無關的知識庫與骨架，於 commit `1df5c02` 一次加入：

| 位置 | 內容 |
|---|---|
| `CLAUDE.md`、`AGENTS.md`、`START_HERE.md` | 隊員與 AI 工具的環境建置、規則摘要 |
| `docs/00-*.md`～`docs/12-*.md`、`docs/README.md` | 規則、TownPass App、雙向溝通、部署、開放資料等知識庫 |
| `docs/templates/` | bridge、雙向溝通測試頁、Handler、FastAPI、Dockerfile、firebase.json、LICENSE、README 樣板 |
| `prep-deploy/` | 雙向溝通測試頁與 Hello API（驗證 Hosting、Cloud Run 部署用） |

`web/src/lib/townpass-bridge.ts`、`api/Dockerfile` 由上述樣板改寫。其餘內容（`docs/13-testing-guide.md`、`starter/`、`docs/arrow-nav/`、`docs/superpowers/`、web、api、routing、scripts 中的服務功能，以及 `app/` 中本隊對 TownPass 的修改）皆於競賽期間完成，可由 commit 紀錄查證。

## 10. 授權

本 repo 與本隊在 App 中新增的程式碼採 **GNU AGPL-3.0** 授權，全文與主辦指定聲明見 [LICENSE](LICENSE)。
`app/` 中的 TownPass 原始程式碼維持其 GPL-3.0 授權（見 [app/LICENSE](app/LICENSE)），兩者相容（GPL-3.0 第 13 條）。

```
一箭成行 — 看不懂地圖也能走到：跟著一支依路線轉彎的箭頭，走到臺北市的公車站牌與任何地點（城市通微服務）
Copyright (C) 2026 王閎立、王昱荃、詹維宏、羅泓勛、許雅晴（一箭成行團隊）

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
