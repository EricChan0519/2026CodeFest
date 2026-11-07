# 03 · 介面合約

這份合約讓 App、前端、後端可以同時開發。**15:30 凍結**，之後要改必須通知受影響的人，並更新這份文件。

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

### `POST /api/routes`

```json
{
  "from": { "lat": 25.1, "lon": 121.5 },
  "to": { "lat": 25.101, "lon": 121.502, "stationUid": "TPE12345" },
  "audience": "elder",
  "candidate": null,
  "simulate": null
}
```

| 欄位 | 說明 |
|---|---|
| `audience` | `elder`、`child`、`visitor` |
| `candidate` | `null` 表示依規則表算全部；重新規劃時傳目前的候選 id，只算這一條 |
| `simulate` | `null` 或 `night`。只用於 Demo，回應會加上 `simulated_night` |

```json
{
  "context": { "audience": "elder", "period": "night", "simulated": false },
  "routes": [
    {
      "id": "fewer_steps_hills_bright",
      "recommended": true,
      "reasons": ["fewer_steps", "brighter", "extra_distance"],
      "distanceM": 380,
      "durationS": 420,
      "geometry": [[25.1, 121.5], [25.1002, 121.5004]],
      "maneuvers": [
        { "kind": "depart", "atIndex": 0, "distanceToNextM": 80, "street": "範例路" },
        { "kind": "left", "atIndex": 12, "distanceToNextM": 300, "street": "範例街" },
        { "kind": "arrive", "atIndex": 30, "distanceToNextM": 0, "street": null }
      ],
      "metrics": { "steps": 0, "climbM": 3, "litRatio": 0.8, "unsignalizedCrossings": 0, "signalCrossings": 2, "unknownCrossings": 1 },
      "diff": { "distanceM": 60, "durationS": 120, "steps": 1, "climbM": 5, "unsignalizedCrossings": 2 }
    },
    {
      "id": "fastest",
      "recommended": false,
      "reasons": ["fastest"],
      "distanceM": 320,
      "durationS": 300,
      "geometry": [[25.1, 121.5], [25.1005, 121.501]],
      "maneuvers": [],
      "metrics": { "steps": 1, "climbM": 8, "litRatio": 0.5, "unsignalizedCrossings": 2, "signalCrossings": 0, "unknownCrossings": 1 },
      "diff": null
    }
  ],
  "notes": [],
  "sources": [
    { "name": "OpenStreetMap", "updatedAt": "2026-11-06" },
    { "name": "臺北市路燈位置分布圖", "updatedAt": "2026-11-07" }
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
| `routes[].metrics` | **階段 1 是 `null`**。沒有資料的欄位是 `null`，例如沒有坡度時 `climbM` 是 `null` |
| `routes[].diff` | 和 `fastest` 比較：`distanceM`、`durationS` 是多走多少；其他是少了多少。`fastest` 本身是 `null` |
| `notes` | `no_better_route`、`simulated_night` |

## 前端 mock

API 負責人 15:30 前提供下列檔案，前端用 `VITE_API_MOCK=1` 切換：

```text
web/src/mocks/stations-nearby.json
web/src/mocks/stations-search.json
web/src/mocks/routes-one.json        只有 fastest，metrics 是 null（階段 1）
web/src/mocks/routes-many.json       長者晚上，兩條路（階段 2）
web/src/mocks/routes-no-better.json  有 no_better_route
```

## 重置與 Demo 網址參數

| 參數 | 作用 |
|---|---|
| `?reset=1` | 清除 localStorage 和導航狀態 |
| `?demo=1` | 模擬行走，用 `web/public/demo/` 的內建路線，不需要連線 |
