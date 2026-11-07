# 08 · 往屆作品（已整併進台北通）

原始碼都在 `reference/`。

| 作品 | 一句話 | 資料 | 技術 | 亮點 / 注意 |
|---|---|---|---|---|
| **ParkFlow 找車位** 2024 `townpass2024-parking` | 停哪裡、停多久、會不會被開單 | 北市好停車即時車位、紅黃線 | Vue 3 + FastAPI；App 自訂 **`timer_set` Handler** 做本機排程通知 | 網頁關了也收得到提醒。用 Mapbox → 今年不行 |
| **RideFlow 騎妙** 2025 `townpass2025-RideFlow` | 5 秒告訴你現在適不適合騎 YouBike | YouBike 即時、今日施工、氣象署、AQI | Vue 3 + FastAPI + XGBoost | 四種資料 → 一句建議（三級標籤）；**README 範本**（架構圖、env、AI 聲明）。用 Google Maps → 今年不行 |
| **即時雨晴** 2024 `townpass2024-weather` | 我這裡現在會不會下雨 | 氣象署雷達回波、1 小時雨量預測 | Flask + 純 HTML/JS + **Leaflet + OSM** | 聚焦單一需求、一頁完成；用內建 `location` |

## 共同點（= 我們的檢查表）
1. **需求明確，一句話說得清楚**
2. **資料皆來自開放資料**
3. **主流程單純、範圍聚焦**（找位→停車→計時／選站→分析→建議／就一頁）
4. **善用 App 原生能力**（定位、自加推播、使用者資料）
5. **README 完整，便於接手**（功能、API、資料來源、架構圖、環境變數、AI 聲明）

## 實作細節參考
- ParkFlow Handler：`reference/townpass2024-parking/flutter/lib/util/web_message_handler/tp_web_message_handler.dart`（`TimerSetMessageHandler`，用 `showScheduledNotification`）；網頁端在 `web/src/views/ParkingService.vue`（data 雙重 stringify，Handler 再 decode — 我們改傳物件）。
- RideFlow README：`reference/townpass2025-RideFlow/README.md` — 結構：專案簡介 → 系統架構（圖 + Tech Stack 表）→ 安裝執行 → env → 功能表（含資料來源）→ 致謝/授權 → AI Usage Declaration（模型、使用範圍、驗證方式、限制風險）。
