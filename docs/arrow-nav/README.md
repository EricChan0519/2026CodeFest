# 跟著箭頭走（暫名）：開發文件

看不懂地圖的人，搜尋要去的地方（公車站牌也可以），跟著一支依路線轉彎的箭頭走過去。

> **2026-11-07 17:10 改版：** 任意地點、內政部 DTM 坡度、監視器與派出所、箭頭依路徑轉彎。設計見 [改版 spec](../superpowers/specs/2026-11-07-any-place-slope-safety-design.md)。01–05 已更新；實作計畫還沒依改版更新，**和 01–05 衝突時以 01–05 為準**。

- **題目：** 數位平權 × 友善共融，第二項「看不懂」（理解限制）
- **對象：** 長者、兒童、外籍人士
- **期限：** 11/8 **07:30 功能凍結**，**09:00 前上傳**（我們的目標是 08:30）
- **文件日期：** 2026-11-07。標「待驗證」的項目還沒有實測。

## 我們分兩階段做

| 階段 | 完成時間 | 內容 |
|---|---|---|
| 階段 1 | 11/7 **23:00** | 主流程（**搜尋任意地點**）、3 種對象、8 種語言、**依路徑轉彎的箭頭**、語音、震動、模擬行走、關於頁。路線只有標準步行，但回應格式已支援多條候選 |
| 階段 2 | 11/8 **03:00** | 依使用者和時間挑路線：長者**坡度最低**（DTM）、晚上與兒童**監視器、派出所、路燈較多**、兒童少過無燈路口；繞路有上限 |

**16:30 要判斷三件事：** 手機上羅盤、持續定位、Valhalla 能不能用。不行就換備案，見 [05](05-stories.md)。

**20:00 再判斷兩件事：** V4 DTM 坡度能不能進 routing、V5 監視器地址轉座標的覆蓋率。見 [05](05-stories.md#技術驗證)。

## 先讀哪些

| 角色 | 負責 | 必讀 |
|---|---|---|
| 全員 | | 本頁、[01 產品規格](01-product-spec.md)、[05 Stories 與分工](05-stories.md) |
| APP（隊長） | App、Handler、APK | [03 合約](03-contracts.md) 的 Bridge、[ADR-0003](architecture/decisions/0003-use-web-sensors-first.md) |
| NAV（前端 1） | 感測與導航 | [04 導航邏輯](04-nav-logic.md)、[03 合約](03-contracts.md) |
| UI（前端 2） | 畫面、對象、語言 | [01 產品規格](01-product-spec.md)、[03 合約](03-contracts.md) 的 REST |
| API-A（後端：服務與資料） | FastAPI、地點與站位、規則表、派出所與監視器快照 | [02 候選路線](02-route-candidates.md)、[03 合約](03-contracts.md) 的 REST、[API 分工](../superpowers/specs/2026-11-07-api-split-design.md) |
| API-B（後端：路徑與地理） | Valhalla、DTM 高程、量測 | [02 候選路線](02-route-candidates.md)、[API 分工](../superpowers/specs/2026-11-07-api-split-design.md) |
| PM（規劃與 Demo） | Repo、README、實測、彩排 | [06 Demo 腳本](06-demo-script.md)、[07 加入新技術](07-adding-tech.md) |

## 文件清單

| 檔案 | 內容 |
|---|---|
| [01-product-spec.md](01-product-spec.md) | 服務定義、範圍、流程、畫面、導航畫面規格、對象設定、易讀規則 |
| [02-route-candidates.md](02-route-candidates.md) | 候選路線規則、資料、演算法、用詞規則 |
| [03-contracts.md](03-contracts.md) | 網頁與 App 的訊息、REST API，平行開發的依據 |
| [04-nav-logic.md](04-nav-logic.md) | 感測來源、導航狀態、箭頭計算、門檻參數、語音規則 |
| [05-stories.md](05-stories.md) | Stories、驗收條件、分工、時程 |
| [06-demo-script.md](06-demo-script.md) | 初選與決選腳本、備援、問答預備 |
| [07-adding-tech.md](07-adding-tech.md) | 隊友加技術前要檢查什麼、接在哪裡 |
| [實作計畫](../superpowers/plans/2026-11-07-arrow-nav.md) | **每個角色要做的任務、測試、順序，開工先看自己的區段** |
| [改版 spec](../superpowers/specs/2026-11-07-any-place-slope-safety-design.md) | 17:10 改版的決定與理由 |
| [architecture/arc42.md](architecture/arc42.md) | C4 圖、部署、品質情境、風險 |
| [architecture/review.md](architecture/review.md) | 架構審查結果，以及因此做的修改 |
| [architecture/decisions/](architecture/decisions/README.md) | 7 份架構決策紀錄（MADR） |
| [architecture/workspace.dsl](architecture/workspace.dsl) | Structurizr 架構模型 |

## 開工順序

1. **PM：** 團隊 repo 是 [EricChan0519/2026CodeFest](https://github.com/EricChan0519/2026CodeFest)，clone 到全英文路徑。從 `starter/` 建 `web/`、`api/`。**repo 目前是私有的，上傳前要改成公開。**
2. **全員：** 讀 [03 合約](03-contracts.md)，**15:30 前**提出意見。之後要改合約，受影響的人都要同意。
3. **API：** 15:30 前把 mock JSON 放進 `web/src/mocks/`，前端不用等後端。
4. **APP、NAV、API：** 先做 3 個技術驗證，16:30 判斷（見 [05](05-stories.md)）。

## 已定案的技術

| 層 | 選擇 |
|---|---|
| App | TownPass fork，Flutter 3.47.6。只有隊長需要 Flutter 環境 |
| 前端 | Vue 3 + Vite + TypeScript + Tailwind 4 + Pinia，部署到 Firebase Hosting。同一份網頁在 Android、iOS 的 WebView 都能跑 |
| 後端 | FastAPI，部署到 Cloud Run（asia-east1） |
| 路徑 | Valhalla + OpenStreetMap（待驗證；備案是 OSRM） |
| 資料 | TDX 公車站位快照、OpenStreetMap（路網、地點）、臺北市路燈位置、內政部 20 公尺 DTM、臺北市警察局派出所地址與監視器設置區位 |
| Demo | Android 實體手機，Android Studio Running Devices 鏡像後接 HDMI |

組員只寫網頁或後端，不需要 Flutter、Java、Android Studio。Valhalla 的 Docker 建置由有環境的人負責。

硬性規則見 [`docs/01-competition-rules.md`](../01-competition-rules.md)：AGPL-3.0、不用 Google Maps 和 Mapbox、執行時 AI 只能在裝置端、核心資料要是開放資料並註明出處。
