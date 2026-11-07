# 知識庫索引

來源：《2026 城市通入門指引》（賽前工作坊 10/25，65 頁）、《競賽須知 115.08.27》、TownPass 原始碼 main@e65b586、開發文件 tpe-guideline.web.app、往屆作品原始碼。2026-11-04 重新比對並以原始碼、實際 API 呼叫補充。

| 檔案 | 內容 | 什麼時候看 |
|---|---|---|
| [00-environment-checklist.md](00-environment-checklist.md) | 講義＋須知所有環境／帳號／準備項目，以及有／沒有 | 賽前 |
| [11-prep-todo.md](11-prep-todo.md) | **賽前前置作業**：依順序、標明誰做 | 賽前（現在） |
| [01-competition-rules.md](01-competition-rules.md) | 規則、繳交、評分、獎金分配、智財、使用者類型 | 開工前、收尾前 |
| [02-townpass-app.md](02-townpass-app.md) | App 建置、結構、加入服務、預設置頂、Android 側載與權限坑、WebView 除錯 | 改 App 時 |
| [03-two-way-communication.md](03-two-way-communication.md) | flutterObject 協定、內建 9 個 Handler 的確切資料格式、自訂 Handler、安全注意 | 寫前端 / 擴充 App |
| [04-microservice-frontend.md](04-microservice-frontend.md) | 官方 Vue 範例、色票、開源地圖圖磚網址、Leaflet 坑、WebView 注意事項 | 寫微服務網頁 |
| [05-backend-and-deploy.md](05-backend-and-deploy.md) | Firebase Hosting、preview channel、/api rewrite、Cloud Run、免費額度、資料儲存、開發迭代 | 部署 |
| [06-on-device-ai.md](06-on-device-ai.md) | 裝置端 LLM 架構、套件、模型、禁用廠牌 | 若有 AI 功能 |
| [07-open-data.md](07-open-data.md) | 開放資料平台、API 實測（格式、金鑰、CORS）、可先逛的主題 | brainstorm / 找資料 |
| [08-past-winners.md](08-past-winners.md) | 三個已整併作品分析與共同點 | brainstorm |
| [09-hackday-playbook.md](09-hackday-playbook.md) | 當天時間表、投影方式、2 分鐘 Demo 腳本、繳交檢查 | 比賽當天 |
| [10-architecture.md](10-architecture.md) | 我們的系統架構與待決定事項（D1–D9） | 一直 |
| [12-scoring-playbook.md](12-scoring-playbook.md) | **評分 → 實作對照**、上傳截止 11/8 09:00、初選輪桌／決選流程、發表腳本、最後檢查表 | 選題、寫計畫、收尾 |
| [13-testing-guide.md](13-testing-guide.md) | **開發中怎麼測試**：電腦瀏覽器、手機瀏覽器（同 Wi-Fi／預覽頻道）、城市通 App 內 | 寫到一個段落要看畫面時 |
| [arrow-nav/](arrow-nav/README.md) | **本次作品規格**：跟著箭頭走的產品規格、合約、Stories、架構 | **現在開工先讀** |
| [templates/](templates/) | 可直接複製的樣板（見下） | 開工 |

## templates/
| 檔案 | 用途 |
|---|---|
| [townpass-bridge.ts](templates/townpass-bridge.ts) | 前端 bridge（send／request／tp 包裝／瀏覽器 mock） |
| [bridge-test/index.html](templates/bridge-test/index.html) | 雙向溝通測試頁：逐一測內建 Handler、前往其他網址、測 API |
| [custom_handler.dart](templates/custom_handler.dart) | App 自訂 Handler 樣板 |
| [api-fastapi/](templates/api-fastapi/) | FastAPI Hello（`/api/health`、CORS 設定） |
| [Dockerfile.fastapi](templates/Dockerfile.fastapi)、[Dockerfile.springboot](templates/Dockerfile.springboot) | 後端容器 |
| [firebase.json](templates/firebase.json) | Hosting 設定（SPA + `/api/**` → Cloud Run） |
| [LICENSE_NOTICE.txt](templates/LICENSE_NOTICE.txt) | AGPL-3.0 指定聲明與 LICENSE 做法 |
| [README_TEMPLATE.md](templates/README_TEMPLATE.md) | 繳交用 README |

原始資料：入門指引、競賽須知與選手須知手冊是主辦文件，不放進 repo（隊長發的 zip 內 `docs/source/` 有 PDF 和全文 txt）。

## 相關資源（講義 p64）
- TownPass 原始碼：github.com/taipei-doit/TownPass ・開發文件（中英）：tpe-guideline.web.app
- 活動官網、競賽須知：codefest.taipei/2026-fall
- Figma UI Kit：開發文件首頁有連結，搜「Town Pass Design Tokens」
- 開放資料：data.taipei ・data.gov.tw ・tdx.transportdata.tw ・城市儀表板 github.com/tpe-doit/Taipei-City-Dashboard
- Flutter 3.47 更新說明：flutter.dev/blog/whats-new-in-flutter-3-47
- 問題：技術 → TownPass GitHub issue；規則 → 承辦單位（電腦公會）
