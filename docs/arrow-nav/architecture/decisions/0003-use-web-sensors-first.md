# 0003. 感測先用網頁能力，備案是 Flutter 跨平台 Handler

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: sensors, app

## Context and Problem Statement

箭頭需要手機朝向，導航需要持續定位。服務跑在 WebView，要從哪裡取得這些資料？

第一版設計用 Kotlin 原生 `TYPE_ROTATION_VECTOR`，但只支援 Android，也不符合既有架構，所以推翻。

## Decision Drivers

- 同一份網頁要能在 Android 和 iOS 跑
- 只有隊長有 Flutter 環境，手邊沒有 Mac
- 陀螺儀單獨無法取得絕對方向，一定要有磁力計資料
- 這是核心功能，失敗要有備案

## Considered Options

1. 網頁能力優先，備案是 Flutter 跨平台 Handler
2. 一開始就全部用 Flutter 感測套件 Handler
3. Kotlin 和 Swift 原生實作

## Decision Outcome

Chosen option: "網頁能力優先"，因為不用改 App 就能驗證，也最容易跨平台。導航邏輯只依賴 `SensorSource`，來源換掉也不用改。

| 能力 | 用什麼 |
|---|---|
| 朝向 | Android `deviceorientationabsolute`；iOS `webkitCompassHeading` |
| 定位 | `watchPosition`；TownPass WebView 已允許網頁定位 |
| 語音 | `speak` Handler（`flutter_tts`），因為 Android WebView 不能依賴 Web Speech |
| 震動 | `haptic` Handler（Flutter `HapticFeedback`），因為 iOS 沒有 `navigator.vibrate` |
| 常亮 | Wake Lock API，備案是 `wakelock_plus` Handler |

### Consequences

- Good: 16:30 前不用動 App 就能判斷
- Good: 不用寫 Kotlin 或 Swift
- Bad: WebView 內的事件精度和支援度要實測
- Bad: **iOS 無法驗證**。`Info.plist` 目前沒有 motion 用途說明，可能要補；文件和發表都要標「待驗證」
- Neutral: 備案的 `flutter_compass` 最後更新在 2024-11，AGP 9 相容性未知；`sensors_plus` 7.1.1（BSD-3）可用加速度計和磁力計自行計算

## Pros and Cons of the Options

### 全部用 Handler

- Good: 能控制取樣頻率和權限
- Bad: 每次調整都要重 build APK，套件相容性有風險

### Kotlin 和 Swift

- Good: 精度最高
- Bad: 兩個平台都要寫，我們也無法驗證 iOS

## More Information

- [03 合約](../../03-contracts.md)、[04 導航邏輯](../../04-nav-logic.md)
- [05 Stories 的 V1、V2](../../05-stories.md)
