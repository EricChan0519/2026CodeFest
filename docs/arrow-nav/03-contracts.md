# 03 · 介面合約

這份合約讓 App、前端、後端可以同時開發。**15:30 凍結**，之後要改必須通知受影響的人，並更新這份文件。

> **17:10 改版（受影響的 NAV、UI、API-B 要看過）：** 新增 `GET /api/places/search`；`POST /api/routes` 的 `to` 加 `placeId`、`candidate` 改用新的目標 id；`metrics`、`diff` 加 `maxGradePct`、`cameras`、`policeNearby`；新增原因代碼見 [02](02-route-candidates.md#原因代碼與文案)。依據見 [改版 spec](../superpowers/specs/2026-11-07-any-place-slope-safety-design.md)。

## 共通規則

- 座標一律用 WGS84。JSON 物件寫 `{ "lat": 25.1, "lon": 121.5 }`，陣列寫 `[lat, lon]`。
- 距離單位是公尺（`M`），時間單位是秒（`S`）。
- 時間用 ISO 8601，時區 `+08:00`。
- 外部資料的格式只能出現在 `api/app/adapters/`，不能傳到前端。
- **使用者座標不能放在網址上**，要放在 POST body。Cloud Run 的請求紀錄會保留網址。
- API 只回代碼和數字，句子由前端的語言檔產生。

## 感測：網頁能力優先

先用網頁能力，不夠才用 Flutter 跨平台套件的 Handler。**不寫 Kotlin 或 Swift。** 原因見 [ADR-0003](architecture/decisions/0003-use-web-sensors-first.md)。

| 能力 | 先用 | 備案 | 16:30 要確認 |
|---|---|---|---|
| 朝向（Android） | `deviceorientationabsolute` | `nav_sensors` Handler | WebView 內有事件，角度對照指南針 |
| 朝向（iOS） | `webkitCompassHeading`，要先 `DeviceOrientationEvent.requestPermission()` | `nav_sensors` Handler | **沒有 Mac，無法驗證** |
| 持續定位 | `navigator.geolocation.watchPosition` | `nav_sensors` Handler（`Geolocator.getPositionStream()`） | App 的 WebView 已允許網頁定位；要確認 App 層權限已授予 |
| 語音 | `speak` Handler（`flutter_tts`） | 文字＋震動 | Android WebView 不能依賴 Web Speech |
| 震動 | `haptic` Handler（Flutter `HapticFeedback`） | 只有語音和文字 | 能分辨三種提示 |
| 螢幕常亮 | Wake Lock API | `screen_awake` Handler（`wakelock_plus`） | WebView 內可以取得 |

## Bridge：網頁與 App

沿用 `flutterObject`。`data` 直接放物件，**不要雙重 `JSON.stringify`**。

```js
window.flutterObject?.postMessage(JSON.stringify({
  name: 'speak',
  data: { text: '前面路口向左轉', lang: 'zh-TW', rate: 'normal', interrupt: true },
}))
```

### 一定要新增的 Handler

| name | 網頁送出 | App 回覆 |
|---|---|---|
| `speak` | `{ text, lang, rate, interrupt }`；`rate` 是 `slow` 或 `normal` | 成功 `{ ok: true }`；失敗 `{ ok: false, code }` |
| `haptic` | `{ pattern: "turn" \| "arrive" \| "warn" }` | 不回覆 |

- `lang`：`zh-TW`、`en-US`、`th-TH`、`vi-VN`、`id-ID`、`km-KH`、`ja-JP`、`ko-KR`。
- `speak` 的 `code`：`no_voice`（手機沒有這個語言）、`tts_error`。網頁收到 `no_voice` 後，這次使用就不再要求該語言的語音。
- `flutter_tts` 版本 4.2.5（MIT）。`rate` 的實際數值由 Handler 對應，Android 和 iOS 要分開設定。

### 備案 Handler：16:30 判斷後才做

| name | 網頁送出 | App 回覆 |
|---|---|---|
| `nav_sensors` | `{ action: "start", sessionId, headingHz }` 或 `{ action: "stop", sessionId }` | 持續回覆下列事件 |
| `screen_awake` | `{ on: true \| false }` | 不回覆 |

```json
{ "name": "nav_sensors", "data": { "type": "heading", "sessionId": "abc123", "deg": 123.4, "ts": 1794030000000 } }
```

```json
{ "name": "nav_sensors", "data": { "type": "position", "sessionId": "abc123", "lat": 25.1, "lon": 121.5, "accuracyM": 8.5, "speedMps": 0.9, "ts": 1794030000000 } }
```

```json
{ "name": "nav_sensors", "data": { "type": "error", "sessionId": "abc123", "code": "location_denied" } }
```

| 欄位 | 說明 |
|---|---|
| `deg` | 手機上緣朝向，**相對磁北**，0–360 度。網頁統一加上磁偏角 |
| `code` | `location_denied`、`location_off`、`no_heading_sensor`、`sensor_error` |

### Handler 實作要求

- 重複 `start` 要先結束舊的訂閱。Handler 是快取單例，不能累積多條訂閱。
- `handle()` 訂閱後要立刻返回，不能等串流結束。
- 只回應允許的來源：正式網址、`townpass-hackathon-2026--*.web.app` 預覽網址、開發用 tunnel。App 的 listener 沒有設 `allowedOriginRules`，要自己檢查 `sourceOrigin`。
- 回覆失敗或 30 分鐘沒有 `stop`，就自動停止感測。
- 位置用 `Geolocator.getPositionStream()`。現有 `location` Handler 的 `getCurrentPosition()` 只適合取一次。
- 朝向用感測套件（`flutter_compass` 或 `sensors_plus`）。兩者都要先確認能在 AGP 9.1.0 建置。

> **待驗證：** 同一個 `onReply` 能否重複呼叫。原始碼是閉包保留 `replyProxy`，應該可行。如果不行，改成網頁每 100 毫秒輪詢。網頁的介面不變。

### 使用現有 Handler

| name | 用途 |
|---|---|
| `location` | 首頁取得一次位置查附近站牌；同時觸發 App 層的定位權限詢問 |

不需要使用 `userinfo`。

## 網頁的感測介面

導航邏輯只依賴這個介面：

```ts
export interface SensorSource {
  // iOS 羅盤權限要由按鈕觸發，「開始走」時呼叫
  requestPermission(): Promise<'granted' | 'denied' | 'not_needed'>
  start(handlers: {
    onHeading(deg: number): void
    onPosition(p: { lat: number; lon: number; accuracyM: number; ts: number }): void
    onError(code: SensorErrorCode): void
  }): void
  stop(): void
}
```

| 實作 | 使用時機 |
|---|---|
| `WebSensorSource` | 預設。App 內和一般手機瀏覽器都用 |
| `HandlerSensorSource` | 16:30 判斷網頁能力不夠時才實作 |
| `ReplaySensorSource` | `?demo=1`，位置來自內建路線，朝向用真實羅盤；沒有羅盤時用滑桿 |

## REST API

路徑都以 `/api` 開頭，由 Firebase Hosting 轉發到 Cloud Run 的 `api` 服務，所以前端不用處理 CORS。

### 錯誤格式

```json
{ "error": { "code": "ROUTE_NOT_FOUND" } }
```

| code | HTTP | 前端顯示 |
|---|---|---|
| `VALIDATION_ERROR` | 422 | 請重新選擇 |
| `OUT_OF_AREA` | 400 | 目前只支援臺北市公車 |
| `ROUTE_NOT_FOUND` | 404 | 找不到走路的路線，請換一支站牌 |
| `ROUTING_UNAVAILABLE` | 503 | 暫時算不出路線，請再試一次 |
| `DATA_UNAVAILABLE` | 503 | 資料暫時讀不到 |

### `GET /api/health`

```json
{ "status": "ok", "version": "abc1234", "stopIndexUpdatedAt": "2026-11-07T15:00:00+08:00" }
```

`GET /api/health?deep=1` 會再檢查路徑服務和資料快照，用於上台前暖機。

### `POST /api/stations/nearby`

```json
{ "lat": 25.1, "lon": 121.5, "radiusM": 500 }
```

回應和下一個 API 相同，依 `distanceM` 由近到遠排序。

### `GET /api/stations/search?q=站名`

這個 API 不傳使用者座標。前端拿到結果後自己算距離。

```json
{
  "stations": [
    {
      "stationUid": "TPE12345",
      "name": { "zh": "範例站", "en": "Example Stop" },
      "bearing": "E",
      "lat": 25.1,
      "lon": 121.5,
      "distanceM": 120,
      "routes": [
        {
          "routeName": { "zh": "307", "en": "307" },
          "direction": 0,
          "headsign": { "zh": "往範例終點", "en": "To Example Terminal" },
          "stopUid": "TPE67890"
        }
      ]
    }
  ],
  "source": { "name": "TDX 公車站位資料", "updatedAt": "2026-11-07T15:00:00+08:00" }
}
```

- 上面的識別碼、站名、路線都是範例。
- 同名不同站位要各自一筆。`en` 可能是 `null`。
- `bearing` 來自 TDX，可能是 `E`、`W`、`S`、`N`、`SE`、`NE`、`SW`、`NW`。前端翻成「往東」，也可能是 `null`。
- `distanceM` 只有 nearby 才有。
- `routes` 要排除只能下車的站（TDX `StopBoarding = -1`）。
- `direction` 是 TDX 的值：0 去程、1 返程、2 迴圈、10 循環、255 未知。前端顯示 `headsign`，不要顯示數字。

### `GET /api/places/search?q=地點`

**17:10 改版新增。** 首頁搜尋框用這個 API。地點和公車站一起搜尋。不傳使用者座標，前端拿到結果後自己算距離。`q` 是 1–50 字。

```json
{
  "places": [
    {
      "placeId": "osm:n123",
      "kind": "place",
      "category": "medical",
      "name": { "zh": "範例醫院", "en": "Example Hospital" },
      "lat": 25.1,
      "lon": 121.5,
      "stationUid": null
    },
    {
      "placeId": "stop:TPE12345",
      "kind": "bus_stop",
      "category": "bus_stop",
      "name": { "zh": "範例站", "en": "Example Stop" },
      "lat": 25.1,
      "lon": 121.5,
      "stationUid": "TPE12345"
    }
  ],
  "sources": [
    { "name": "OpenStreetMap", "updatedAt": "2026-11-07" },
    { "name": "TDX 公車站位資料", "updatedAt": "2026-11-07T15:59:00+08:00" }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `kind` | `place` 或 `bus_stop`。`bus_stop` 進 P4 選路線和方向；`place` 直接進 P5 |
| `category` | `medical`、`school`、`station`、`park`、`government`、`shop`、`food`、`tourism`、`bus_stop`、`other`。前端用來選圖示 |
| `placeId` | OSM 地點是 `osm:n<id>`、`osm:w<id>`；公車站是 `stop:<stationUid>` |
| `name.en` | 可能是 `null` |
| `stationUid` | 只有 `bus_stop` 有值；同名的多個站位合成一筆，選了以後用 `/api/stations/search` 的結果分方向 |

- 排序：名稱完全相同 → 開頭相同 → 包含；同級時 `station`、`medical`、`government` 在前，再比名稱長度。最多 20 筆。
- 沒有結果時回 `places: []`，不是 404。
- 地點快照讀不到時回 503 `DATA_UNAVAILABLE`。

### `POST /api/landmarks/search`

**11/7 晚上新增，`/lab/nav` 的「地點與地址」用。** 地標、餐廳、學校…（Overture Maps Places 快照，不含連鎖店；連鎖店在前端 `poi_index.json`）。
和上面規劃中的 `GET /api/places/search` 不同：這個要依**使用者現在的位置**回傳最近的結果，所以座標放 POST body（ADR-0005），不記錄。
之後做 `GET /api/places/search` 時可以直接用同一個 `PlaceIndex`（`api/app/places.py`）。

```json
{ "q": "台北市立大學天母體育館", "lat": 25.1135, "lon": 121.5375, "limit": 20 }
```

`lat`、`lon` 可省略（省略時依資料信心排序、`distanceM` 是 `null`）；`q` 1–60 字；`limit` 1–50，預設 20。

```json
{
  "places": [
    { "name": "天母體育館", "lat": 25.115164, "lon": 121.534019, "address": null, "category": "運動場館", "distanceM": 396 }
  ],
  "source": { "name": "Overture Maps Places", "release": "2026-10-21.0", "license": "CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0", "updatedAt": "2026-11-07T21:21:33+08:00" }
}
```

- 比對規則與排序見 [08-poi-data.md](08-poi-data.md#地標餐廳學校後端地點索引)：依距離由近到遠；搜尋字串 4 字以上時名稱完全一樣的排最前面。
- 沒有結果回 `places: []`；快照讀不到回 503 `DATA_UNAVAILABLE`；`q` 正規化後是空的回 422。

### `POST /api/around`

某一點附近有沒有路燈、監視器、派出所。座標放 body、不記錄（ADR-0005），所以用 POST，不是 GET。

```json
{ "lat": 25.118, "lon": 121.5266, "radiusM": 50, "policeRadiusM": 150 }
```

`radiusM` 預設 50（5–300），用在路燈和監視器；`policeRadiusM` 預設 150（10–1000），用在派出所。

```json
{
  "radiusM": 50,
  "policeRadiusM": 150,
  "lamps": { "nearby": true, "cells": 13 },
  "cameras": 2,
  "police": [{ "name": "範例派出所", "distanceM": 92 }],
  "sources": [{ "name": "臺北市路燈位置分布圖", "updatedAt": "2026-11-07T16:03:38+08:00" }]
}
```

| 欄位 | 說明 |
|---|---|
| `lamps` | `cells` 是半徑內有路燈的約 30 公尺方格數，`nearby` 是 `cells > 0`。**不是路燈盞數，也不是亮度** |
| `cameras` | 半徑內的監視器數（警察局設置的）。座標只準到數十公尺，不代表拍得到這一點 |
| `police` | 半徑內的派出所與分局，依距離由近到遠；沒有就是 `[]` |
| 任一項是 `null` | 該快照不存在或損壞（或監視器地址轉座標的涵蓋率低於 50%）。**不是 0**，畫面不能寫成「沒有」 |
| `sources` | 只列有用到的資料 |

不在服務範圍（臺北）回 400 `OUT_OF_AREA`。回應不會帶回使用者的座標。

### `POST /api/routes`

```json
{
  "from": { "lat": 25.1, "lon": 121.5 },
  "to": { "lat": 25.101, "lon": 121.502, "placeId": "stop:TPE12345", "stationUid": "TPE12345" },
  "audience": "elder",
  "candidate": null,
  "simulate": null
}
```

| 欄位 | 說明 |
|---|---|
| `to.placeId`、`to.stationUid` | 都可以是 `null`。**只用座標算路**，這兩個欄位不參與計算 |
| `audience` | `elder`、`child`、`visitor` |
| `candidate` | `null` 表示依規則表算全部；重新規劃時傳目前路線的 `id`，只產生並挑選這個目標。可用值：`fastest`、`flattest`、`flattest_watched`、`fewer_unsignalized_watched`、`fewer_unsignalized_watched_bright`、`watched_bright` |
| `simulate` | `null` 或 `night`。只用於 Demo，回應會加上 `simulated_night` |

```json
{
  "context": { "audience": "elder", "period": "night", "simulated": false },
  "routes": [
    {
      "id": "flattest_watched",
      "recommended": true,
      "reasons": ["flatter", "more_cameras", "extra_distance"],
      "distanceM": 380,
      "durationS": 420,
      "geometry": [[25.1, 121.5], [25.1002, 121.5004]],
      "maneuvers": [
        { "kind": "depart", "atIndex": 0, "distanceToNextM": 80, "street": "範例路" },
        { "kind": "left", "atIndex": 12, "distanceToNextM": 300, "street": "範例街" },
        { "kind": "arrive", "atIndex": 30, "distanceToNextM": 0, "street": null }
      ],
      "metrics": { "steps": 0, "climbM": 3, "maxGradePct": 4.5, "litRatio": 0.8, "unsignalizedCrossings": 0, "signalCrossings": 2, "unknownCrossings": 1, "cameras": 9, "policeNearby": 1 },
      "diff": { "distanceM": 60, "durationS": 120, "steps": 1, "climbM": 5, "maxGradePct": 3.0, "unsignalizedCrossings": 2, "cameras": 5, "policeNearby": 1 }
    },
    {
      "id": "fastest",
      "recommended": false,
      "reasons": ["fastest"],
      "distanceM": 320,
      "durationS": 300,
      "geometry": [[25.1, 121.5], [25.1005, 121.501]],
      "maneuvers": [],
      "metrics": { "steps": 1, "climbM": 8, "maxGradePct": 7.5, "litRatio": 0.5, "unsignalizedCrossings": 2, "signalCrossings": 0, "unknownCrossings": 1, "cameras": 4, "policeNearby": 0 },
      "diff": null
    }
  ],
  "notes": [],
  "sources": [
    { "name": "OpenStreetMap", "updatedAt": "2026-11-06" },
    { "name": "臺北市路燈位置分布圖", "updatedAt": "2026-11-07" },
    { "name": "內政部 20 公尺網格數值地形模型", "updatedAt": "2025-12-06" },
    { "name": "臺北市政府警察局名稱及地址", "updatedAt": "2026-11-04" },
    { "name": "臺北市政府警察局錄影監視系統設置區位", "updatedAt": "2026-10-13" }
  ]
}
```

上面的數字是格式範例。

| 欄位 | 說明 |
|---|---|
| `routes` | 至少一條，正好一條 `recommended: true`，放在第一個 |
| `routes[].id` | 見 [02](02-route-candidates.md) 的規則表 |
| `routes[].reasons` | 只有量得到改善才有。代碼見 [02](02-route-candidates.md) |
| `routes[].geometry` | `[lat, lon]`，不要傳 polyline 字串 |
| `routes[].maneuvers[].kind` | `depart`、`straight`、`slight_left`、`slight_right`、`left`、`right`、`uturn`、`stairs`、`arrive` |
| `routes[].metrics` | `cameras` 是路線 50 公尺內的監視器數，`policeNearby` 是 150 公尺內的派出所數。**階段 1 是 `null`**。沒有資料的欄位是 `null`，例如高程網格不存在時 `climbM`、`maxGradePct` 是 `null`，監視器沒通過 V5 時 `cameras` 是 `null`。算法見 [02](02-route-candidates.md#量測欄位) |
| `routes[].diff` | 和 `fastest` 比較，`fastest` 本身是 `null`。`distanceM`、`durationS` 是**多走**多少；`steps`、`climbM`、`maxGradePct`、`unsignalizedCrossings` 是**少了**多少；`cameras`、`policeNearby` 是**多了**多少 |
| `notes` | `no_better_route`、`simulated_night` |
| `sources` | 只列這次回應用到的資料；前端關於頁另列全部 |

## 公車＋捷運規劃（手機端）

**11/7 23:00 新增。** 輸入目的地後，在手機上同時規劃公車和捷運，提供三個分頁：**最快（混搭）**、**只搭公車**、**只搭捷運**。做法和現有的公車規劃（`directBus.ts`、`transferBus.ts`）一樣：用 TDX 開放資料的快照，在裝置上計算，不呼叫外部規劃服務，關掉網路也能規劃。

- 目的地搜尋不變：沿用 `/api/places/search` 和 `web/src/lib/geocode.ts`（Nominatim）。Demo 只有我們自己用，Nominatim 由前端直接呼叫；README 要註明地址會送到 OSM Nominatim。
- 每段步行都用箭頭導航，一路帶到目的地。搭車段沿用現有的「到站 → 上車了 → 坐車 → 下車了」。
- 介面上的時間一律寫「約 N 分鐘（預估）」。這不是即時班表，不要寫成「幾點到」。

### 捷運快照 `metro_index.json`

由 `scripts/build_metro_index.py` 產生，放在 `api/data/metro_index.json`，副本放在 `web/public/lab/metro_index.json`，第一次規劃時才下載。TDX 的欄位名稱只會出現在這支腳本裡。

```json
{
  "updatedAt": "2026-11-07T23:30:00+08:00",
  "defaults": [],
  "lines": [
    { "lineId": "BL", "name": { "zh": "板南線", "en": "Bannan Line" }, "color": "#0070BD", "headwayS": 300 }
  ],
  "stations": [
    {
      "stationId": "BL12",
      "name": { "zh": "台北車站", "en": "Taipei Main Station" },
      "lat": 25.0463,
      "lon": 121.5174,
      "exits": [
        { "exitId": "M3", "name": "M3", "lat": 25.0471, "lon": 121.5168, "elevator": true }
      ]
    }
  ],
  "patterns": [
    {
      "lineId": "BL",
      "headsign": { "zh": "往南港展覽館", "en": "To Taipei Nangang Exhibition Center" },
      "stops": ["BL01", "BL02", "BL03"],
      "runS": [120, 110],
      "firstS": [21600, 21720, null],
      "lastS": [86400, 86520, null]
    }
  ],
  "transfers": [
    { "from": "BL12", "to": "R10", "walkS": 240 }
  ]
}
```

上面的數字和識別碼是格式範例。

| 欄位 | 說明 |
|---|---|
| `defaults` | 哪些欄位因為 TDX 讀不到而用了預設值，例如 `["runS", "exits"]`。關於頁和 README 據此說明 |
| `lines[].color` | 路線代表色，`#RRGGBB`，坐車卡用。TDX 沒有時由腳本補上官方色 |
| `lines[].headwayS` | 平均班距（秒），用來估候車時間。TDX `Frequency` 讀不到時用 360 |
| `stations[].stationId` | TDX `StationID`。同一個實體車站在不同路線有不同 id（台北車站是 `BL12` 和 `R10`），用 `transfers` 連起來 |
| `stations[].exits` | 出口座標。走路段的目標是離起點或下一個目標最近的出口，不是車站中心點。沒有出口資料時是 `[]`，改用車站座標 |
| `patterns` | 每條路線、每個方向一筆，兩個方向分開列。支線（小碧潭、新北投）各自一筆 |
| `patterns[].runS` | 長度是 `stops.length - 1`；`runS[i]` 是 `stops[i]` 到 `stops[i+1]` 的行車加停站秒數。TDX `S2STravelTime` 讀不到時每站用 120 |
| `patterns[].firstS` / `lastS` | 選用。長度和 `stops` 相同；`[i]` 是在 `stops[i]` 往這個方向上車的首班、末班秒數，從當天 0 點算，**凌晨 4 點前算前一天的營運**（00:10 記成 87000）。最後一站不會上車，是 `null`。來自 TDX `FirstLastTimetable`；區間車、支線沒有自己的資料時借同一條線、同方向的全線時刻。整份讀不到時省略，並在 `defaults` 寫 `serviceHours` |
| `transfers` | 站內換線，雙向各一筆；`walkS` 來自 TDX `LineTransfer`，讀不到時用 240。LineTransfer 沒有可用資料時，改連 300 公尺內同名的車站；名稱不同的轉乘站（新埔民生 ↔ 新埔）寫在腳本的 `EXTRA_TRANSFERS` |

TDX 端點是 `/api/basic/v2/Rail/Metro/{X}/{TRTC|NTMC}`（環狀線屬新北捷運 NTMC）。只收 `BR`、`R`、`G`、`O`、`BL`、`Y` 六條線，輕軌不收。11/7 用金鑰實測：6 條線、136 站（132 站有出口）、24 個方向、36 筆換線；`runS` 有 4 段、`transfers` 用了預設值。TDX 的首末班欄位拼成 `DestinationStaionID`（少一個 t），腳本兩種都收。

#### 公車快照的首末班（`stop_index.json`）

`scripts/build_stop_index.py` 另外抓 TDX `/v2/Bus/Schedule/City/Taipei`，在 `patterns[]` 加選用欄位：

```json
"service": { "weekday": [19800, 79200], "weekend": [21600, 79200] }
```

- 值是起點站的首班、末班發車秒數（凌晨 4 點前一樣加 24 小時）；那種日子沒有班次是 `null`。
- 班表（`Timetables`）取每一班第一站的發車時間；班距（`Frequencys`）取 `StartTime`／`EndTime`。副路線合併，取最早首班、最晚末班。
- TDX 很多路線只給去程班表：回程沒有時**借去程的時間（估計）**。11/7 實測 969 個路線方向裡 947 個有首末班。
- 沒有 `service` 的路線方向，前端不判斷末班車，一律當作有車。

### 型別變更（`web/src/nav/journey.ts`）

```ts
export type RideMode = 'bus' | 'metro'

export interface Ride {
  mode: RideMode                 // 新增；舊的公車規劃一律填 'bus'
  board: Station
  route: StationRoute
  alight: Station
  stops: Station[]
  lineColor?: string             // 新增：捷運才有
  stopTimesS?: number[]          // 新增：捷運才有，從上車站起算到 stops[i] 的累計秒數，stopTimesS[0] = 0
  boardPoint?: LatLon            // 新增：走路段的目標（捷運是出口座標）；沒有時用 board 的座標
  boardExit?: string             // 新增：捷運進站出口代號（exitId），例如 "M3"
  alightPoint?: LatLon           // 新增：下車後步行的起點（捷運是出口座標）
  alightExit?: string            // 新增：捷運出站出口代號
  firstS?: number                // 新增：今天在這個上車站的首班秒數；沒有資料時省略
  lastS?: number                 // 新增：今天在這個上車站的末班秒數；沒有資料時省略
}
```

- 捷運站轉成現有的 `Station` 形狀：`stationUid` 寫成 `metro:BL12`，`bearing` 是 `null`，`routes` 只放這一段用到的那一筆。那一筆的 `routeName` 是路線名稱，`headsign` 是 `patterns[].headsign`，`direction` 是 `255`，`stopUid` 是 `metro:BL12`。這樣到站卡、坐車卡不用分兩套。
- `stopTimesS` 的長度和 `stops` 相同。
- 出口用 `exitId`（「M3」），不用 TDX 的 `ExitName`（「台北車站M3」太長）。走去搭捷運時，標題顯示「走到 台北車站 M3 搭 淡水信義線」（`Destination.exit`）。
- 公車的 `firstS`／`lastS` 是起點站的時間加上 `from × 90` 秒；捷運直接取 `patterns[].firstS[i]`／`lastS[i]`。

### 規劃器（`web/src/lib/transitPlan.ts`）

```ts
export type PlanTab = 'mixed' | 'bus' | 'metro'
export type ServiceState = 'ok' | 'ended' | 'not_started'

export interface TransitPlan {
  rides: Ride[]                  // [] 表示走路就到
  durationS: number              // 預估總時間，用來排序
  walkS: number
  waitS: number
  rideS: number
  walkM: number                  // 全程步行公尺數（估算值，只用來顯示和排序）
  service: ServiceState          // 任一段車走到上車站時末班已過 → ended；首班還沒開 → not_started
}

export function planTransit(
  bus: { stations: Station[]; patterns: RoutePattern[] },
  metro: MetroIndex | null,      // null：捷運快照沒載入，metro 分頁是 []，mixed 只有公車
  from: LatLon,
  to: LatLon,
  opts: { audience: Audience; now?: Date },   // now 預設現在，測試用
): Record<PlanTab, TransitPlan[]>
```

| 規則 | 值 |
|---|---|
| 每個分頁最多幾筆 | 3；能搭的（`service: 'ok'`）排前面，再依 `durationS` 由小到大 |
| 最多搭幾段車 | 3（捷運站內換線也算一段） |
| 起點、終點最多走多遠 | 直線 800 公尺；某個分頁找不到路時依序放寬到 1500、2500 公尺（捷運站離得遠也有路可選，步行時間照算） |
| 步行速度 | 長者 0.9 m/s；兒童、外籍人士 1.1 m/s。步行距離用直線 × 1.25 估算 |
| 公車 | 每坐一站 90 秒；候車 300 秒，市民小巴（路線名有「小巴」）900 秒；每次上車多算 120 秒，避免為了省一點時間多轉一次 |
| 不排的公車 | 路線名含「觀光巴士」或「通勤」；同一條線下車又上車 |
| 營運日 | 從凌晨 4 點算起；平日／假日依營運日判斷（星期六 00:30 還算星期五晚上） |
| 捷運 | 行車用 `runS`；候車用 `headwayS / 2`；站內換線用 `transfers[].walkS` 再加下一班的候車 |
| 公車 ↔ 捷運轉乘 | 公車站位離捷運出口（沒有出口時用車站座標）300 公尺內 |
| 走路就到 | 距離不到 400 公尺，或直接走過去比最快的搭車方案還快時，`mixed` 第一筆放 `rides: []` |

- `mixed` 是全部方案（含只搭公車、只搭捷運）裡最快的 3 筆；`bus`、`metro` 只含單一運具。
- 某個分頁是 `[]` 時，畫面上顯示「沒有只搭捷運的路線」，那個分頁不能點。
- `service` 不是 `'ok'` 的方案仍列出來，但**反灰、不能選**，下方寫「末班車已過」或「首班車還沒開」。全部方案都收班時，箭頭留在「走路過去」。
- 規劃器是純函式，不碰 DOM、不呼叫 API，用 Vitest 測試。

### 行程狀態機的改變

| 情境 | 行為 |
|---|---|
| 捷運站內換線 | `gotOff` 後，如果下一段的上車站和這一段的下車站有 `transfers` 關係，跳過走路段，直接進 `at_stop`。到站卡顯示「在台北車站換 淡水信義線 往象山」 |
| 坐捷運 | 地下常常沒有 GPS，用 `stopTimesS` 和按下「上車了」之後經過的秒數推算到第幾站。剩一站時提醒「下一站下車」，並震動 `turn` |
| 坐公車 | 不變，沿用 `rideStatus()` 用定位判斷 |
| 下車 | 不論公車或捷運，都要使用者按「下車了」確認。到了預估的下車時間就提醒「請下車」，但不自動切換 |
| 走去搭捷運 | 目標是 `boardPoint`（出口）；標題「走到 台北車站 M3 搭 淡水信義線」 |
| 下捷運後走路 | 從 `alightPoint`（出口）開始導航；畫面提示「從 M3 出口出站」 |

### 分工與時間

| 誰 | 做什麼 | 完成時間 |
|---|---|---|
| API | 手寫小快照 `web/src/lib/__fixtures__/metro_index.mini.json`（板南線、淡水信義線在台北車站附近幾站，含一筆換線），前端先用 | 11/7 23:30 |
| API | `scripts/build_metro_index.py`＋測試，產生正式快照 | 11/8 00:30 |
| NAV | `transitPlan.ts`、`journey.ts` 的換線與捷運坐車，含測試 | 11/8 02:00 |
| UI | 三個分頁、坐車卡的路線顏色和「往○○」、出入口提示、8 種語言的文字 | 11/8 02:30 |
| 全員 | 串起來，用模擬行走跑一次「公車轉捷運」 | 11/8 03:00 |

### 路線模式：`POST /api/routes` 加 `mode`（2026-11-07 23:30）

主畫面的「路線模式」選單（快速／安全／平緩）用這個。有 `mode` 時**不看對象規則表、忽略 `candidate`**；`audience` 只決定走路速度（長者 3.5 km/h）。算法見 [02 的路線模式](02-route-candidates.md#路線模式使用者選)。

```json
{ "from": {"lat": 25.1175, "lon": 121.531}, "to": {"lat": 25.107, "lon": 121.524}, "audience": "visitor",
  "candidate": null, "simulate": null, "mode": "safe", "quick": false }
```

| 欄位 | 說明 |
|---|---|
| `mode` | `fast`、`safe`、`gentle` |
| `quick` | `true`：走到一半重新規劃，不另外找經過點的繞行路線，回得比較快。預設 `false` |

回應和上面相同，另外：

| 欄位 | 說明 |
|---|---|
| `context.mode`、`context.maxTimeRatio` | 使用者選的模式；`1.2`＝任何一條路的 `durationS` 都不超過最快路線的 1.2 倍 |
| `routes` | `fast`：一條 `fastest`。`safe`／`gentle`：推薦的路（`id` 是 `safe` 或 `gentle`）＋`fastest`；沒有量得到的改善時只有 `fastest`，`notes` 加 `no_better_route` |
| `routes[].edges` | `[[begin, end, use, roadClass], ...]`：路段種類（Valhalla `trace_attributes`），`begin`、`end` 是 `geometry` 的索引。前端用來判斷過馬路；問不到是 `null` |
| `routes[].metrics` 新欄位 | `stores`（40 公尺內便利商店數）、`shopRatio`（沿路有店面的比例）、`quietRatio`（走在小巷、私人車道、產業道路、山徑的長度比例）、`mainRoadRatio`（走在主要道路的長度比例）。後兩個只有路線模式算 |
| `routes[].diff` 新欄位 | `litRatio`、`cameras`、`policeNearby`、`stores`、`shopRatio`、`mainRoadRatio` 是**多了**多少；`quietRatio` 是**少了**多少。一律「正數＝比較好」 |
| `reasons` 新代碼 | `more_cameras`、`near_police`、`more_stores`、`more_shops`、`fewer_alleys`、`main_roads`、`extra_time`（多走 30 秒以上，且有其他原因） |
| `sources` | 有便利商店快照時加 `Overture Maps Places（便利商店、店面）` |

## 前端 mock

API 負責人提供下列檔案，前端用 `VITE_API_MOCK=1` 切換。標「改版」的由 API-A 在 **18:30 前**補上或更新：

```text
web/src/mocks/stations-nearby.json
web/src/mocks/stations-search.json
web/src/mocks/places-search.json      改版：地點和公車站混合，含 en 為 null 的一筆
web/src/mocks/routes-one.json         只有 fastest，metrics 是 null（階段 1）
web/src/mocks/routes-many.json        改版：長者晚上 flattest_watched＋fastest，含新欄位（階段 2）
web/src/mocks/routes-no-better.json   有 no_better_route
web/src/mocks/routes-two-turns.json   改版：fastest，先左轉再右轉，NAV 測轉彎用
```

## 重置與 Demo 網址參數

| 參數 | 作用 |
|---|---|
| `?reset=1` | 清除 localStorage 和導航狀態 |
| `?demo=1` | 模擬行走，用 `web/public/demo/` 的內建路線，不需要連線 |
| `?night=1` | 主畫面：路線模式用 `simulate: "night"`（安全模式的路燈權重變高），「怎麼去」標示「模擬晚上」 |
| `?setup=1` | 主畫面：重新選語言、年紀、路線模式 |
