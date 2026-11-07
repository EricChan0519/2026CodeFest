# 11 · 賽前前置作業（11/4 週三 → 11/7 週六開賽）

> 依「越早做越省事」排序。環境現況見 [00](00-environment-checklist.md)。原則：**賽前只準備與題目無關的東西**（見 [01](01-competition-rules.md)「程式碼的時間範圍」）。
> 標記：🤖 可以請 Claude 代做（會先問你）／🙋 只能你本人做（帳號、實體、付款相關）／👥 全隊

## 1. 雲端打通（11/4–11/5，約 30 分鐘）
| # | 事項 | 誰 | 說明 |
|---|---|---|---|
| 1-1 | ✅ 11/4 完成：雙向溝通測試頁部署到 Hosting | 🤖 | [templates/bridge-test/index.html](templates/bridge-test/index.html)；之後 App 的 destinationUrl 先指向它 |
| 1-2 | ✅ 11/4 完成：Hello API 部署到 Cloud Run（asia-east1），API 已啟用 | 🤖 | [templates/api-fastapi/](templates/api-fastapi/) + [Dockerfile.fastapi](templates/Dockerfile.fastapi) |
| 1-3 | ✅ 11/4 完成：`/api/**` rewrite，`https://townpass-hackathon-2026.web.app/api/health` 可通 | 🤖 | [templates/firebase.json](templates/firebase.json) |
| 1-4 | ✅ 11/5 完成：帳單預算警示 | 🙋 | GCP Console › 帳單 › 預算與快訊 |
| 1-5 | 把隊友加進 Firebase 專案（才能各自部署 preview channel） | 🙋 | Firebase Console › 專案設定 › 使用者和權限；需要隊友的 Google 帳號 |

## 2. App 建置與賽前練習（講義 p32，**講義要求每位成員都做**）
| # | 事項 | 誰 | 說明 |
|---|---|---|---|
| 2-1 | 硬碟清出 20 GB 以上（目前 38 GB） | 🙋 | 首次 Android build 約吃 5–10 GB |
| 2-2 | ✅ 11/5（`C:\dev\townpass`）`flutter pub get` → `build_runner` → build APK → 模擬器 | 🤖／👥 | 指令見 [02](02-townpass-app.md)；JDK 25 可用；要先裝 NDK 29.0.13113456；路徑不能有中文 |
| 2-3 | ✅ 11/5 練習：新增 SVG → `MyServiceItemId` → destinationUrl 先填 `https://www.gov.taipei/` → 在 App 加入「我的服務」 | 👥 | 講義指定的賽前練習 |
| 2-4 | destinationUrl 改成我們的 Hosting 測試頁，9 個內建 Handler 逐一按 | 👥 | 確認 location／notify／qr_code_scan 在實機正常 |
| 2-5 | ⚠️ INTERNET 已補、release APK 還沒側載測：main manifest 補 `INTERNET` 權限，`flutter build apk --release` 側載到另一支手機，確認打得開網頁 | 🤖／👥 | 不補的話 release 版很可能沒網路（見 02） |
| 2-6 | 試 `chrome://inspect` 看手機 WebView 的 console | 👥 | 當天除錯主要靠它 |
| 2-7 | 有 Mac 的隊友：iOS build 一次（下載 Swift Package 很久） | 👥 | 沒 Mac 就全隊用 Android Demo |

## 3. 帳號與金鑰（越早越好）
| # | 事項 | 誰 | 說明 |
|---|---|---|---|
| 3-1 | ✅ 11/5 完成：**TDX** 會員與 API 金鑰（Client Id／Secret） | 🙋 | tdx.transportdata.tw 註冊 → Email 驗證 → **等管理員審核**（所以要今天就申請）→ 會員中心 › API 金鑰（最多 3 組）；金鑰只放後端環境變數 |
| 3-2 | 申請**中央氣象署**授權碼 | 🙋 | opendata.cwa.gov.tw 加入氣象會員 → Email 確認 → 登入 › API 授權碼 › 取得授權碼（立即產生） |
| 3-3 | 收集全隊 GitHub 帳號，開賽時加 collaborator | 👥 | |
| 3-4 | Figma 打開 Town Pass UI Kit 看一遍（設計師／前端） | 👥 | 開發文件首頁有連結 |

## 4. 工具（約 20 分鐘）
| # | 事項 | 誰 | 指令／說明 |
|---|---|---|---|
| 4-1 | VS Code 擴充：Flutter、Vue (Volar)、ESLint、Prettier、Tailwind | 🙋 | 見 [00](00-environment-checklist.md) F 節 |
| 4-2 | **投影實機畫面**：用發表筆電的 Android Studio › Running Devices 鏡像手機，接 HDMI 試一次 | 👥 | 做法見 [09](09-hackday-playbook.md)；scrcpy 當備案 |
| 4-3 | pnpm（要跑官方範例才需要） | 🤖 | `npm install -g pnpm` |
| 4-4 | cloudflared（選配，手機看筆電 dev server） | 🤖 | `winget install Cloudflare.cloudflared` |

## 5. 隊伍討論（找一個晚上，約 1 小時）
| # | 事項 | 說明 |
|---|---|---|
| 5-1 | 確認技術選型 D1–D9 | [10](10-architecture.md) 已寫「傾向」：Vue 3 + FastAPI + Leaflet/國土測繪中心 + Hosting rewrite |
| 5-2 | 分工 D7（建議：App／前端 ×2／後端＋資料／規劃＋Demo＋README） | 須知建議角色：專案規劃師、資料工程師、前端、後端 |
| 5-3 | 統一 AI 工具與工作流程（Claude Code + Superpowers），分支與 review 規則 | 每人裝好同樣工具；本資料夾的 CLAUDE.md 開賽時搬進 repo |
| 5-4 | **獎金分配方式先講好** | 須知：得獎後要書面提供分配方式與帳號 |
| 5-5 | 盤點手機：幾支 Android、RAM 多少（決定能不能做裝置端 AI）、有沒有 Mac | |
| 5-6 | 跑一個往屆作品（建議 `townpass2024-weather`，Flask + 純 HTML，最簡單） | 看別人怎麼寫 bridge 與 README |
| 5-7 | 逛資料：每人挑 [07](07-open-data.md) 的一兩個主題，記下資料集名稱、連結、更新頻率、有沒有座標、CORS | 題目公布後 brainstorm 會快很多 |
| 5-8 | 讀一遍 [01](01-competition-rules.md) 規則與 [09](09-hackday-playbook.md) 當天流程 | 尤其：禁用 Google Maps／Mapbox、AI 只能裝置端、不能用簡報 |

## 6. 11/6（週五）晚上最終檢查
- [ ] 每人筆電：`flutter doctor` 無紅字、`git`、`node`、`docker` 正常；`firebase login`、`gcloud auth list` 還有效
- [ ] 至少一支 Android 手機已裝自建 App，可打開 Hosting 測試頁且雙向溝通正常
- [ ] Hello API 在 Cloud Run 可通
- [ ] TDX／氣象署金鑰存在**密碼管理器或私訊**，不要放進 repo
- [ ] 攜帶：證件（每人）、延長線、**可傳資料的手機線**、HDMI／USB-C 轉接頭、Demo 手機兩支、手機熱點、過夜用品（比賽中間不間斷）
- [ ] 手機、筆電、行動電源充飽
- [ ] 找到**行前須知裡的作品上傳系統帳密**（11/8 09:00 前要上傳；當天賽場須知也會發）
- [ ] 全隊讀過 [12-scoring-playbook.md](12-scoring-playbook.md)：評分對照、輪桌初選要隨時有人能 Demo、決選自帶筆電＋HDMI 轉接頭
