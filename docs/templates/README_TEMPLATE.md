# <服務名稱>

> 一句話：<現在這裡會不會下雨 / 5 秒告訴你…>

2026 臺北秋季程式設計節 · 城市通微服務大黑客松 參賽作品。

## 1. 專案簡介
- **解決的問題**：
- **目標使用者與情境**：
- **核心功能**：1. … 2. … 3. …
- Demo 截圖 / GIF：

## 2. 系統架構
（架構圖：城市通 App ⇄ 微服務網頁 → 後端 → 開放資料）

| 類別 | 技術 / 版本 | 備註 |
|---|---|---|
| App | TownPass (Flutter 3.47.6) | 新增服務、自訂 Handler：… |
| 前端 | | 部署：Firebase Hosting |
| 後端 | | 部署：Cloud Run asia-east1 |
| 地圖 | Leaflet / MapLibre + OpenStreetMap | 開源 |

### App ↔ 網頁訊息
| name | data | reply |
|---|---|---|

## 3. 安裝與執行
### App
```bash
cd app && fvm install && fvm flutter pub get && fvm dart run build_runner build --delete-conflicting-outputs && fvm flutter run
```
### 前端
```bash
cd web && pnpm install && pnpm dev
```
### 後端
```bash
cd api && docker build -t api . && docker run -p 8080:8080 --env-file .env api
```
### 環境變數（`.env.example`）
| 變數 | 說明 | 取得方式 |
|---|---|---|

## 4. 功能說明
| 編號 | 功能 | 簡述 | 資料來源 |
|---|---|---|---|

## 5. 資料來源
| 資料集 | 提供機關 | 連結 | 用途 | 真實/模擬 |
|---|---|---|---|---|

## 6. 第三方套件與授權
| 套件 | 版本 | 授權 | 用途 |
|---|---|---|---|

## 7. 六面向說明
- 安全：
- 創新：
- 有感：
- 參與：
- 便利：
- 透明：
- 營運接手：資料由誰更新、問題由誰處理

## 8. AI 使用聲明
### 開發階段
| 工具 | 用途 | 約佔比例 |
|---|---|---|
人工驗證方式：
### 執行階段（裝置端推論，若有）
| 模型名稱 | 版本 | 量化格式 | 推論框架 | 來源 / 授權 |
|---|---|---|---|---|

## 9. 授權
本專案採 GNU AGPL-3.0 授權。<主辦指定授權聲明>
