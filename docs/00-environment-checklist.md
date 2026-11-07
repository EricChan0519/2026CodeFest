# 00 · 環境與準備清單（講義 + 競賽須知全部項目）

> ⚠️ **這份是隊長電腦的檢查結果**，只當作「講義要求哪些東西」的參考。你自己的環境請照根目錄的 [START_HERE.md](../START_HERE.md) 檢查。

> 首次檢查 2026-11-03，**2026-11-04 重新檢查**（作者電腦：Windows 11、Ryzen 7 260）。✅ 有 ／ ⚠️ 有但要處理 ／ ❌ 沒有 ／ ❓ 電腦上查不到，需人工確認
> 來源頁碼：講義 = 《城市通入門指引》；須知 = 《競賽須知 115.08.27》
> **接下來要做什麼** → 看 [11-prep-todo.md](11-prep-todo.md)

## A. 硬體（講義 p11）
| 項目 | 要求 | 現況 | 狀態 |
|---|---|---|---|
| CPU | 8 核 | 8 核 16 緒 | ✅ |
| 記憶體 | 16 GB | 31.3 GB | ✅ |
| 可用硬碟 | 60 GB | **38 GB 可用**（11/4，比 11/3 又少 3 GB） | ⚠️ 差約 22 GB；Android 首次 build（Gradle 快取＋產出）約吃 5–10 GB，做裝置端 AI 再加數 GB |
| Mac（iOS 建置） | iOS 要 Mac，建議 Apple Silicon | 這台是 Windows | ⚠️ 不一定需要，見下方說明 |
| 實機手機 | 至少一台裝自建 App；Demo 用兩支 | — | ❓ **隊上要有 Android 手機** |
| 裝置端 AI 實機 | 8 GB RAM 手機較穩 | — | ❓（有做 AI 才需要） |

> **iOS 與 Mac（講義 p9）**：參賽作品通常是「在 WebView 中執行的微服務網頁＋選配後端」，App 本身不一定要改。網頁寫一次，在 iOS 和 Android 的城市通 App 裡都能跑，**寫微服務網頁不需要 Mac**。
> 只有兩種情況需要 Mac：①要把**自己 build 的 App 裝到 iPhone** 上 Demo；②要改 App 的 Flutter／原生程式（例如自訂 Handler、裝置端 AI）並在 iOS 驗證。
> → 沒有 Mac 的做法：Demo 一律用 **Android 手機**；網頁在 Chrome DevTools 開手機模擬測試；不要用 `window.open`／彈出視窗，iOS 預設會擋（講義 p16）。

## B. 開發工具（講義 p10–12）
| 工具 | 要求 | 現況 | 狀態 |
|---|---|---|---|
| Flutter | 3.47.6（`.fvmrc`） | 3.47.8 stable（`C:\src\flutter`） | ⚠️ 修補版本不同，多半能用；要完全一致就裝 FVM |
| FVM | 依 `.fvmrc` 管版本 | 未安裝 | ❌（選配） |
| Dart | ≥ 3.13 | 3.13.7 | ✅ |
| Java | **17** | 系統 OpenJDK 25.0.2；Flutter 實際用 Android Studio 內建 JBR **25.0.3** | ✅ 11/5 實測 JDK 25 可以 build TownPass |
| Android Studio + SDK | SDK、模擬器 | 已裝；SDK 37、build-tools 36/37、NDK、授權已接受 | ✅ |
| Android 模擬器 | — | AVD `Pixel_8` | ✅ |
| adb | — | 在 SDK `platform-tools` 裡，但沒加進 PATH | ⚠️ 小事，Flutter 自己找得到；用 scrcpy 時要加 |
| Xcode | iOS 用 | Windows 無法安裝 | ❌（只寫微服務網頁就用不到；見 A 節說明） |
| VS Code | 裝 Flutter 與前端擴充套件 | 1.144；Dart、Flutter、Vue (Volar)、ESLint、Prettier、Tailwind 都已裝 | ✅ 11/5 |
| Git | 第一天建 repo | 2.55 | ✅ |
| GitHub CLI `gh` | （選配） | 未安裝 | ❌ 選配 |
| Docker | 後端封裝成容器 | Docker Desktop 29.8，daemon 有在跑 | ✅ |
| Postman | 測後端 API | 12.30.3 | ✅ |
| Chrome DevTools | 模擬手機版面；`chrome://inspect` 除錯手機 WebView | Chrome 156 | ✅ |
| Node.js / npm | 前端 build、firebase-tools | Node 24.21、npm 11.19 | ✅ |
| pnpm | 官方範例 `pnpm install` | 未安裝 | ❌（`npm i -g pnpm` 或 `corepack enable`；自己的專案用 npm 也行） |
| Python | 後端（往屆都用 FastAPI／Flask） | 3.13.15（Python313，有 pip） | ✅（注意：PATH 上先找到的是 msys64 那支 python，**沒有 pip**） |
| Firebase CLI | `firebase deploy` | 已安裝並登入，Hosting 已部署過預設頁 | ✅（換電腦用 `npm install -g firebase-tools`） |
| gcloud CLI | `gcloud run deploy` | SDK 588，**預設專案已是 `townpass-hackathon-2026`** | ✅ |
| 投影實機畫面（補充，非講義） | 把 Android 手機畫面投到筆電再接投影 | 隊伍決定用 **Android Studio 的 Running Devices 鏡像**（已安裝）；scrcpy 當備案（未安裝） | ⚠️ 還沒用實機試過 |
| cloudflared／ngrok（補充） | 讓手機用 HTTPS 連到筆電上的 dev server | 未安裝 | ❌ 選配（見 [05](05-backend-and-deploy.md)「開發迭代」） |

## C. 帳號與金鑰（講義 p40、p54、p63）
| 項目 | 狀態 |
|---|---|
| GitHub 帳號 | ✅；**隊友的 GitHub 帳號** ❓ 要收集，開 repo 時加 collaborator |
| GCP／Firebase 專案 | ✅ 專案 ID `townpass-hackathon-2026` · Console：https://console.firebase.google.com/project/townpass-hackathon-2026/overview · Hosting：https://townpass-hackathon-2026.web.app |
| 帳單帳戶綁定（Cloud Run／Cloud Build 需要） | ✅ 11/4 確認已綁 |
| Cloud Run／Cloud Build／Artifact Registry API | ✅ 11/4 已啟用；預設 compute 服務帳號已加 `roles/run.builder` |
| 預算警示（補充） | ✅ 11/5 已設 |
| 隊友加入 Firebase 專案（補充） | ⚠️ 11/5 已寄邀請；IAM 目前仍只有隊長 1 人 → 隊友要**到信箱接受邀請**才會生效 |
| TDX 金鑰（公車／捷運／YouBike） | ✅ 11/5 隊長已取得（Client Id／Secret 由隊長保管，比賽當天設成 Cloud Run 環境變數，不進 repo） |
| 中央氣象署 API 授權碼 | ❓（用到天氣資料才需要；登入 opendata.cwa.gov.tw 即可取得） |
| Figma（Town Pass UI Kit） | ❓（只看檔案不需付費帳號） |

## D. 專案準備進度（講義 p32、p54、p63 賽前練習）
| 項目 | 狀態 |
|---|---|
| clone TownPass 最新版 | ✅ `reference/TownPass`（e65b586, 10/17） |
| `pub get` + `build_runner` + build APK 成功 | ✅ 11/5 在 `C:\dev\townpass`（中文路徑會失敗；需先裝 NDK 29.0.13113456；JDK 25 可用） |
| 賽前練習：新增 SVG → MyServiceItemId → 在 App 加入「我的服務」 | ✅ 11/5「雙向溝通測試」預設置頂，模擬器上 flutterObject、deviceinfo、notify、`/api/health` 都正常（userinfo 已按，沒逐行確認；location 未測） |
| 在自己手機上測過 | ❌ |
| Hello World 前端部署到 Firebase，App 開得起來 | ✅ 11/5 從模擬器的 App 打開確認 |
| Hello World 後端部署到 Cloud Run | ✅ 11/4 `api` → https://api-239765207532.asia-east1.run.app/api/health ；經 Hosting `/api/health` 也通、CORS 正確 |
| 隊伍 repo（公開、AGPL-3.0 + 須知指定聲明） | ❌（第一天建；LICENSE 樣板已備好 [templates/LICENSE_NOTICE.txt](templates/LICENSE_NOTICE.txt)） |
| repo 放 CLAUDE.md／AGENTS.md | ✅ 草稿在本資料夾 |
| 先 clone 一個往屆作品跑跑看 | ⚠️ 三個都 clone 了，還沒跑 |
| 練功專案（補充） | ✅ `專案資料夾/codefest2026`（城市水路：Vue 3 + Leaflet + Tailwind + FastAPI/Spring + data.taipei 直飲臺），可當技術選型與程式起手式參考 |
| 先逛過 data.taipei、TDX 資料集 | ⚠️ 已實測 API 格式與 CORS（見 [07](07-open-data.md)），還沒逛題材 |
| 先試用開源地圖（Leaflet／MapLibre）、圖表套件 | ⚠️ 練功專案用過 Leaflet + OSM；國土測繪中心圖磚已實測可用 |
| 統一 AI 工具、約定分支與 review 分工 | ❓（隊伍內決定） |

## E. 比賽當天攜帶（講義 p63、須知 參-三）
| 項目 | 狀態 |
|---|---|
| 政府核發證件（身分證／健保卡／駕照／護照／居留證）— 每位隊員都要 | ❓ |
| 延長線、手機線（**要能傳資料的線**，不是只能充電）、投影轉接頭（這台筆電要 HDMI／USB-C 轉接） | ❓ |
| Demo 手機兩支（含備用），已開「開發人員選項 › USB 偵錯」 | ❓ |
| 自己的電腦設備（自行保管） | ✅ |
| 全員到場報到（截止後 30 分鐘沒到可能被取消資格） | ❓ |
| 過夜用品（補充：比賽「中間不間斷」）— 外套、盥洗、行動電源 | ❓ |

## F. 補裝指令（建議順序）
```bash
npm install -g pnpm
```
```bash
cd "C:/dev/townpass" && flutter pub get && dart run build_runner build --delete-conflicting-outputs
```
```bash
flutter run
```
- VS Code 擴充：`Dart-Code.flutter`（會連帶裝 Dart）、`Vue.volar`、`dbaeumer.vscode-eslint`、`esbenp.prettier-vscode`、`bradlc.vscode-tailwindcss`
- Java 17：若 Android build 失敗，裝 Temurin 17，再執行 `flutter config --jdk-dir="C:\Program Files\Eclipse Adoptium\jdk-17..."`
- 硬碟：清出至少 20 GB
