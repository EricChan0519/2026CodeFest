# 03 · App ↔ 微服務雙向溝通

原始碼：`reference/TownPass/lib/util/web_message_handler/`（`tp_web_message_handler.dart`、`tp_web_message_listener.dart`、`tp_web_message_reply.dart`）、`lib/util/tp_web_view.dart`。
底層：`flutter_inappwebview` 的 **WebMessageListener**，注入 JS 全域物件 **`flutterObject`**。

## 流程
```
網頁                                         App
① flutterObject.postMessage(JSON字串 {name,data}) ─▶ ② TPWebMessageListener: jsonDecode → 依 name 找 handler
                                                     ③ TPWebMessageHandler.handle(message = data 欄位)
⑤ 'message' 事件, event.data = JSON 字串 {name,data} ◀─ ④ replyWebMessage(data) → jsonEncode({name,data})
```

## 網頁端
```js
// 送出（只能傳一個字串）
window.flutterObject?.postMessage(JSON.stringify({ name: 'location', data: null }));
// 接收（所有回覆共用同一個 'message' 事件 → 用 name 分流）
const onReply = (event) => {
  const { name, data } = JSON.parse(event.data);
  if (name === 'location') console.log(data.latitude, data.longitude);
};
window.flutterObject?.addEventListener('message', onReply);
// 離開頁面一定要 removeEventListener，避免重複觸發
```
- 一般瀏覽器**沒有 `flutterObject`** → 先判斷，必要時用 mock 資料（我們的樣板：[templates/townpass-bridge.ts](templates/townpass-bridge.ts)）。
- 官方 Vue composables：`useConnectionMessage(name, data)`、`useHandleConnectionData(cb)`（在 view 層呼叫一次，onUnmounted 自動移除）。
- **`data` 直接放物件即可，不要再 JSON.stringify 一次**。App 端只 decode 外層一次，`message` 就是原本的物件（Map）；若雙重 stringify，Handler 收到的是 String（ParkFlow 2024 就是這樣，Handler 內自己再 decode）。內建 `notify` 要求 Map，雙重 stringify 會失敗。
- 雙向溝通**只在 App 內運作**，部署後務必在 App 內實測。

## 內建 Handler（確切格式，依原始碼）
| name | 送出 data | 回覆 data | 備註 |
|---|---|---|---|
| `userinfo` | `null` | Account 物件（見 02 Mock 帳號），無則 `[]` | |
| `location` | `null` | geolocator `Position.toJson()`：`latitude, longitude, accuracy, altitude, heading, speed, timestamp…`；失敗回 `[]` | 權限問題會回 `[]`，要處理 |
| `deviceinfo` | `null` | `device_info_plus` 的 data map；無則 `[]` | |
| `qr_code_scan` | 任意 | 掃描結果（開 App 掃碼頁，回傳 route 結果；取消可能為 null） | |
| `notify` | `{ "title": string, "content": string }` | 成功不回覆；格式錯回 `false` | content 符合「已訂閱X」「已取消訂閱X」會同步 App 訂閱清單 |
| `open_link` | URL 字串 | 成功不回覆；null 回 `false` | 在 App 內 WebView 開（`local://route` 開 App 頁） |
| `launch_map` | URL 字串（如 Google/OSM 地圖連結） | `true/false`（canLaunch） | 用系統 url_launcher 開外部 |
| `phone_call` | 電話號碼字串 | `true/false` | `tel://` |
| `1999agree` | 非 null 任意值 | 同意流程失敗回 `false` | 先走使用者同意頁，再跳撥號 Dialog |

⚠️ 原始碼小 bug：`launch_map`、`phone_call` 收到 null 時回 false 但**沒 return**，接著會拋例外 → 網頁端一定要傳非空字串。

## 自訂 Handler（擴充 App 能力）
1. 繼承 `TPWebMessageHandler`（寫在 `tp_web_message_handler.dart` 或新檔）
2. `name` 對應網頁送出的 name，**避免與內建重名**
3. 加入 `TPWebMessageListener._cachedMessageHandlers` 清單
4. 網頁 postMessage `{ name: 'xxx', data: ... }`

樣板：[templates/custom_handler.dart](templates/custom_handler.dart)
```dart
class GreetingMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'greeting';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    onReply?.call(replyWebMessage(data: '哈囉，$message！'));
  }
}
```
- 去年叫 `CPWebMessageHandler`，今年改 `TPWebMessageHandler`（往屆 code 要改名）。
- 可擴充方向：NFC、藍牙、陀螺儀、健康資料、音訊、IoT、Wi-Fi、AR/VR、**裝置端 AI**、本機排程通知（ParkFlow 的 `timer_set`）。
- 擴充流程：pub.dev 找 MIT/BSD/Apache 套件 → 封裝成 Handler → 設雙平台權限（Info.plist 用途說明 + AndroidManifest permission）。
- 目前 App 已宣告權限：Android `ACCESS_FINE_LOCATION`、`ACCESS_BACKGROUND_LOCATION`；iOS 定位、相機、相簿。

## Listener 行為細節
- `onPostMessage` 收到後 `jsonDecode(webMessage.data)`，**迴圈比對所有 handler 的 name**（同名多個會全跑）。
- reply 經 `replyProxy.postMessage` 回到**發送該訊息的 frame**。
- WebView 的 geolocation prompt 預設全部允許（`onGeolocationPermissionsShowPrompt` allow: true）→ 網頁也可直接用 `navigator.geolocation`，但官方建議走 `location` handler。
- iOS 預設阻擋彈出視窗、Android 需自行處理 → `window.open` 少用，用 `open_link`。
- **沒有設定 `allowedOriginRules`** → 預設 `*`，**任何網址**的頁面都會被注入 `flutterObject`。
  - 好處：在同一個 WebView 裡 `location.href` 跳到別的 HTTPS 網址（preview channel、tunnel），bridge 照樣能用 → 一次 build 的 App 可以測所有開發版網址（見 [templates/bridge-test/index.html](templates/bridge-test/index.html) 的「前往網址」）。
  - 安全面：任何被開啟的網頁都能拿到 `userinfo`（姓名、身分證字號、電話）。決選「安全」面向可提：我們的自訂 Handler 檢查 `sourceOrigin` 只回應自己的網域；網頁不把 userinfo 原樣送後端、不寫進 log／localStorage。
- `userinfo` 含身分證字號、電話等個資（雖是假資料，整併後會是真資料）→ 只取需要的欄位，送後端前去識別化。

## 開發與測試流程
1. 瀏覽器開發：bridge 樣板在沒有 `flutterObject` 時回 mock → `npm run dev` + DevTools 手機模擬。
2. App 內測：部署到 Firebase（或 preview channel／tunnel，都要 HTTPS）→ App 開服務 → `chrome://inspect` 看 console（見 [02](02-townpass-app.md)「在手機上除錯」）。
3. 先用 [templates/bridge-test/index.html](templates/bridge-test/index.html) 確認 9 個內建 Handler 在自己手機上都正常，再開始寫功能。
