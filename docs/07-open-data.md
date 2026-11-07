# 07 · 開放資料

| 平台 | 網址 | 說明 |
|---|---|---|
| **臺北市資料大平臺** | data.taipei | 北市各機關資料，**優先使用** |
| 政府資料開放平臺 | data.gov.tw | 全國 |
| **TDX 運輸資料流通服務** | tdx.transportdata.tw | 公車、捷運、YouBike；**免費註冊取金鑰，提早申請** |
| 臺北城市儀表板 | dashboard.gov.taipei | 市政指標，開源（github.com/tpe-doit/Taipei-City-Dashboard），App 已內建 |
| 中央氣象署 | opendata.cwa.gov.tw | 需授權碼（往屆用過雷達回波、雨量預測、GraphQL） |
| 環境部 | data.moenv.gov.tw | AQI 等 |
| 北市好停車 | — | 即時車位（ParkFlow 用過） |

## 規則
- 核心資料須為**合法開放資料並註明出處**；非核心可用模擬資料（README 標示）。
- README 與 Demo 標資料集名稱 + 連結。
- AI 常捏造 API 網址/資料集/欄位 → **逐一打開來源確認**。

## API 實測（2026-11-04）
| 來源 | 呼叫方式 | 要金鑰 | 前端可直打（CORS） | 結論 |
|---|---|---|---|---|
| data.taipei | `GET https://data.taipei/api/v1/dataset/{resource_id}?scope=resourceAquire&limit=1000&offset=0` → `{ result: { count, results: [...] } }` | 否 | ❌ 只允許 `https://data.taipei` | **要經後端**（或 build 時先抓成 JSON） |
| YouBike 2.0 臺北即時 | `GET https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json`（約每分鐘更新） | 否 | ✅ `*` | 前端可直接用 |
| TDX | 先 `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`（`grant_type=client_credentials`、`client_id`、`client_secret`，form 格式）拿 token，再帶 `Authorization: Bearer <token>` 打 `https://tdx.transportdata.tw/api/basic/v2/...` | **是**（不帶回 401） | — | 金鑰不能放前端 → **要經後端**；token 要快取重用 |
| 中央氣象署 | `GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/{資料代碼}?Authorization=<授權碼>` | **是**（不帶回 401） | — | 授權碼不能放前端 → **要經後端** |

- data.taipei 單次 `limit` 最多 **1000** 筆（傳 2000 也只回 1000），超過要用 `offset` 分頁。範例 resource_id `a6e90031-…` 是「垃圾車點位路線」，共 4012 筆。
- data.taipei 的 resource_id 在資料集頁面的「API」分頁可以找到；也可直接下載 CSV／JSON 檔。
- 欄位常是中文名（`行政區`、`經度`、`緯度`），經緯度常是**字串**，要轉數字；部分資料集是 TWD97 座標，要轉成 WGS84 才能放地圖。
- → 只要核心資料來自 data.taipei、TDX 或氣象署，**幾乎一定需要後端**（D3）。

## 往屆用過的資料集
YouBike 2.0 臺北即時資訊、臺北市今日施工資訊、紅黃線資料、氣象署雷達回波/1 小時雨量預測、環境部 AQI、臺北市所屬直飲臺（我們的練功專案）。

## 講義案例對應的資料方向
- 「我的申請辦到哪了」→ 申辦項目、案件進度（多為模擬，需找真實申辦項目清單）
- 「急了附近哪裡有」→ 哺乳室、AED、公廁、飲水機、行動電源租借等友善據點（data.taipei / data.gov.tw）

## 賽前可以先逛的題材（依城市服務常見主題，題目公布後再對照）
| 主題 | 可找的資料 |
|---|---|
| 交通 | YouBike、公車／捷運即時（TDX）、停車場剩餘車位、施工、道路事件 |
| 環境 | 空品 AQI、雨量／雷達、垃圾車路線與時間、資源回收 |
| 友善據點 | AED、哺乳室、公廁、直飲臺、避難所、無障礙設施 |
| 社福與長照 | 長照據點、社區關懷據點、托育資源 |
| 安全與防災 | 避難收容處所、淹水潛勢、消防栓、監視器位置 |
| 文化與觀光 | 圖書館、活動、景點、市場 |
- 逛的時候記下：**資料集名稱、連結、更新頻率、格式、有沒有座標、CORS**。

## 微服務六種常見型態（可組合）
公告・優惠・查詢・申請・支付・地圖
