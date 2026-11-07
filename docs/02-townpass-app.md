# 02 · 城市通 App（Flutter）

原始碼：`reference/TownPass/`（main@e65b586, 2026-10-17）。開發文件：https://tpe-guideline.web.app/docs/

## 整體架構
```
城市通 App (Flutter)  ⇄ 雙向溝通 ⇄  我們的微服務網頁 (WebView, 框架不限)  → API(選配) →  後端  → 開放資料
 已提供：帳號、定位、通知、掃碼                                                     data.taipei / data.gov.tw / TDX
```
參賽作品通常 = **一個微服務網頁 + 視需要的後端**。App 不一定要改，但要把服務加進「服務」頁，並在需要原生能力時加自訂 Handler。

## 版本
| 項目 | 版本 | 備註 |
|---|---|---|
| Flutter | 3.47.6 | `.fvmrc`；用 FVM 最方便 |
| Dart | ≥ 3.13 | pubspec environment |
| iOS | ≥ 15 | UIScene lifecycle、**Swift Package Manager**（CocoaPods 維護模式，外掛優先選支援 SPM） |
| Android | AGP 9.1.0 / Kotlin 2.4.0 / Gradle 9.3.1 | **Java 17**；build 有狀況先 `flutter clean` |
| Material/Cupertino | 已拆成 `material_ui`、`cupertino_ui` | 內建版 11 月才標棄用，比賽期間照舊即可 |

主要依賴：`get`(GetX)、`flutter_inappwebview ^6.1.5`、`geolocator`、`flutter_local_notifications`、`mobile_scanner`、`device_info_plus`、`url_launcher`、`shared_preferences`、`flutter_svg`、`flutter_gen_runner`、`json_serializable`。

## 建置
```bash
git clone https://github.com/taipei-doit/TownPass.git && cd TownPass
fvm install
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run
```
- `build_runner` 產生 `lib/gen/assets.gen.dart`（圖示/mock 路徑）與 JSON 序列化程式。**新增 SVG 後要重跑**。
- 首次建置久；iOS 會下載 Swift Package。iOS 需 Mac（建議 Apple Silicon）。
- 本機環境（作者電腦，Windows）：Flutter 位於 `C:\src\flutter`、JDK 25（講義要 17，還沒驗證 25 能不能 build）、Node 已裝、無 gh CLI。
- ⚠️ **專案路徑不能有中文**（Windows）：放在 `…\專案資料夾\黑克松\practice\TownPass` 時 `dart run build_runner build` 失敗，訊息 `Unable to write file: …\.dart_tool\build\entrypoint\build.dart.aot`；同一份 code 放到 `C:\dev\townpass` 就成功（2026-11-05）。
- ⚠️ **NDK 版本**：`android/app/build.gradle` 寫死 `ndkVersion = "29.0.13113456"`。沒裝時 Gradle 會呼叫舊的 `sdkmanager.bat` 自動安裝，在這台電腦上會崩潰（`NTSTATUS 0xC0000409`）。解法：先用新版 Android CLI 裝好：
  ```bash
  "%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\android.exe" sdk install "ndk;29.0.13113456"
  ```
  （或 Android Studio › SDK Manager › SDK Tools › 勾 Show Package Details › NDK 29.0.13113456）。
- ✅ 2026-11-05 實測：Flutter 3.47.8 + **JDK 25** 可以 build（不用另裝 Java 17）；首次 `flutter build apk --debug` 約 11 分鐘，debug APK 約 230 MB。
- 沒裝 FVM：把指令開頭的 `fvm` 拿掉即可，並確認 `flutter --version` 為 3.47.x。
- 去年 fork 過的隊伍：從最新 main 重新 fork 再搬改動（講義 p14）。

## Android 安裝到 Demo 手機（依原始碼確認，2026-11-04）
- `applicationId = com.example.townpass`；release 目前**用 debug 金鑰簽章**（`android/app/build.gradle` 有 TODO）→ `flutter build apk --release` 產出的 APK 可以直接側載到隊友手機，不用另設簽章。
- ⚠️ **`INTERNET` 權限只寫在 `src/debug`、`src/profile` 的 manifest，`src/main` 沒有**；`flutter_inappwebview_android` 外掛也沒宣告。→ release／側載用的 APK 很可能**打不開任何網頁**。要裝到 Demo 手機前，在 `android/app/src/main/AndroidManifest.xml` 補：
  ```xml
  <uses-permission android:name="android.permission.INTERNET" />
  ```
  （`flutter run` 的 debug 版有，所以開發時不會發現。）
- 通知：`POST_NOTIFICATIONS` 由 `flutter_local_notifications` 外掛宣告；App 啟動時（`main.dart` onInit）會請求通知權限 → Demo 手機第一次開 App 要按「允許」。
- 相機：`CAMERA` 由 `mobile_scanner` 外掛宣告。定位：main manifest 已有 `ACCESS_FINE_LOCATION`。
- 手機準備：設定 › 關於手機 › 連點「版本號碼」開開發人員選項 → 開 USB 偵錯 → 用**能傳資料的線**接電腦，`flutter devices` 看得到才算成功。
- Android 9 以上預設**禁止 http 明文連線**（WebView 也是）→ destinationUrl 和 API 一律用 https。開發時讓手機連筆電的方法見 [05](05-backend-and-deploy.md)「開發迭代」。

## 在手機上除錯 WebView 裡的網頁
- **Android**：debug 版 App（`flutter run`）開著服務 → 電腦 Chrome 開 `chrome://inspect/#devices` → 找到 WebView 按 inspect，就有完整 DevTools（console、network、元素）。若沒出現，在 `main()` 加 `InAppWebViewController.setWebContentsDebuggingEnabled(true);`。
- **iOS**：`TPWebView` 沒傳 `initialSettings`，`isInspectable` 預設 false → Safari 網頁檢閱器看不到；要在 `tp_web_view.dart` 給 `InAppWebViewSettings(isInspectable: kDebugMode)`（需 Mac）。
- 不想接線：開發版網頁載入 **eruda**（MIT，手機上的 console 面板），上線前拿掉。

## 專案結構與常改位置
```
lib/
├─ bean/        資料模型（account, activity, message, subscription…）
├─ page/        頁面（city_service = 服務頁, city_service_edit = 編輯置頂, home…）
├─ service/     AccountService, GeoLocatorService, NotificationService, DeviceService, SubscriptionService…（GetxService）
├─ util/        TP 元件（tp_colors, tp_text_styles, tp_button, tp_dialog, tp_route, tp_web_view…）
│  └─ web_message_handler/  ← 雙向溝通（見 03）
└─ main.dart
assets/mock_data/  account.json, activity.json, home_banner.json, message.json, subscription.json
assets/svg/        108 個圖示（可直接用）
fonts/             PingFang TC
```
| 要做的事 | 檔案 |
|---|---|
| 新增服務 | `lib/page/city_service/model/my_service_model.dart` |
| 預設置頂（我的服務） | `lib/page/city_service/widget/pinned_service_widget_controller.dart` |
| 網路權限（release 必補） | `android/app/src/main/AndroidManifest.xml` |
| 熱門區 | `lib/page/city_service/model/trending_service_model.dart` |
| 服務拼貼四卡 | `lib/page/city_service/widget/official_service_card/*`（onTap 有 TODO，填網址即可） |
| 擴充原生能力 | `lib/util/web_message_handler/` |
| 切換測試帳號 | `assets/mock_data/account.json` |
| 權限 | `android/app/src/main/AndroidManifest.xml`、`ios/Runner/Info.plist` |

## 把服務加進城市通（4 步）
1. SVG 放 `assets/svg/`，檔名 snake_case（`icon_my_service.svg`）→ 跑 build_runner → `Assets.svg.iconMyService.svg()`
2. `MyServiceItemId` enum 加 `myService,`（現有 21 個，最後一個是 `zoo`）
3. `MyServiceIdExt` 的 switch 加 case：
```dart
MyServiceItemId.myService => MyServiceItem(
  title: '我的新服務',
  description: '一句話介紹這個服務',
  icon: Assets.svg.iconMyService.svg(),
  category: MyServiceCategory.cityLife, // cityService 市政服務 | healthCare 防疫醫療 | cityLife 城市生活 | explore 探索臺北 | other 其他服務
  destinationUrl: 'https://my-service.web.app/',
  forceWebViewTitle: null, // 選填：強制 WebView 標題
),
```
4. `flutter run` → 服務 › 更多 → 加入「我的服務」
- 賽前練習時 destinationUrl 先填 `https://www.gov.taipei/`（講義 p32），能開就代表流程對了；再換成我們的測試頁。
- 熱門：在 `TrendingServiceModel.serviceList` 加 `TrendingService(title:, icon:, url:)`
- 服務拼貼：`lib/page/city_service/widget/official_service_card/` 四張卡（top_left 有話要說・警政報警、top_right 防疫醫療・市政 APP、bottom_left、bottom_right 城市生活），`onTap` 還是 TODO，填網址即可導向我們的服務。去年用 JSON 設定，今年改成 Widget。
- ⚠️ **「我的服務」置頂清單沒有存檔**：`lib/page/city_service/widget/pinned_service_widget_controller.dart` 的 `_pinnedList` 是記憶體裡的 RxList，預設 `locationSearch, districtOffice, dashboard`，最多 12 個。從「更多」手動加入的服務，**App 重開就不見**。→ Demo 前直接把我們的 id 加進 `_pinnedList` 預設值（放第一個），再加進「熱門」，評審一打開就看得到。
- `TPRoute.openUri(uri:)`：scheme `local://<route>` 走 App 內頁；其他開 `TPWebView`。

「服務」頁四區塊：①我的服務（使用者置頂）②更多/新增 ③服務拼貼 ④熱門。
使用者三種進入情境：目標明確（引導置頂）、需求未明確（主動推薦）、隨意瀏覽（放熱門）。**Demo 先選定主要對象與情境。**

## Mock 帳號（`userinfo` 回傳內容）
`AccountService` 用 rootBundle 讀 `account.json` 的 `data`：
```json
{ "id": "7f3562f4-…", "account": "wz7786", "username": "Wesley", "realName": "金大森",
  "idNo": "A123456789", "email": "…", "phoneNo": "0932166777", "birthday": "1988/12/12",
  "memberType": "personal", "verifyLevel": "3",
  "addresses": [{ "zip3": 104, "city": "臺北市", "town": "中山區", "village": "正得里", "street": "吉林路", "usageType": "0", "seq": 1, "priority": true }],
  "residentAddress": "臺北市中山區吉林路 69 號 4 樓", "citizen": true, "nativePeople": false, "cityInternetUid": "" }
```
展示「非市民」「長者」情境 → 改 `citizen`、`birthday`。全是假資料。

## 設計規範
- Figma：**Town Pass UI Kit**（45+ 畫面、100+ 元件），開發文件首頁有連結，搜「Town Pass Design Tokens」。
- 色票（`lib/util/tp_colors.dart`，50→950）：**Primary 500 `#5AB4C5`**、**Secondary 500 `#F5BA4B`**、**Grayscale 500 `#738995`**
  - Primary: 50 `#EDF8FA` 100 `#DBF1F5` 200 `#B4E2EA` 300 `#93D4DF` 400 `#71C5D5` 500 `#5AB4C5` 600 `#468D9B` 700 `#356C77` 800 `#22474E` 900 `#112629` 950 `#081315`
  - Secondary: 50 `#FDF8ED` 100 `#FCF2DF` 200 `#F8E3BC` 300 `#F4D69E` 400 `#F0C87C` 500 `#F5BA4B` 600 `#E7A43C` 700 `#AD7B2B` 800 `#74521B` 900 `#3C2B0B` 950 `#1C1304`
  - Grayscale: 50 `#F1F3F4` 100 `#E3E7E9` 200 `#CAD1D5` 300 `#ADB8BE` 400 `#91A0A8` 500 `#738995` 600 `#5E6D76` 700 `#475259` 800 `#30383D` 900 `#171B1D` 950 `#080D0E`
- 字體：中文 PingFang TC、英數 Roboto。字級（TPTextStyles）：h1 36・h2 24・title 18・h3 16・body 14・caption 12。
- WebView AppBar 背景 primary500、白字；網頁標題會被拿來當 AppBar 標題（除非 forceWebViewTitle）。

## 無障礙（12 類，對照數位發展部規範）
AT 替代文字・AV 時序媒體（無自動播放）・NT 通知可朗讀・**TS 觸控目標 ≥ 48×48dp**・FC 焦點順序上→下左→右・FM 表單標籤清楚・LK 連結描述明確・DC 不閃爍・ST 每頁一個標題・AD 內容順序合邏輯・**DT 文字放大 200% 可讀**・PD 導覽一致。
考量長者、視障者。文件：tpe-guideline.web.app/docs/accessibility/
