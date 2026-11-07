# 09 · 比賽當天作戰手冊

> 賽前要做的事（含負責人、順序）→ [11-prep-todo.md](11-prep-todo.md)。這份只放**當天**。

## 開賽前 30 分鐘（到場後）
- [ ] 全員報到、出示證件（截止後 30 分鐘沒到可能被取消資格）
- [ ] 筆電、手機充電；延長線接好；確認場地 Wi-Fi，**準備手機熱點當備援**
- [ ] Demo 手機：App 已裝（含 INTERNET 權限的版本）、通知與定位已允許、`flutter devices` 看得到
- [ ] `gcloud config get-value project` = `townpass-hackathon-2026`；`firebase login` 還有效

## 當天時間配置（建議）
| 階段 | 做什麼 | 產出 |
|---|---|---|
| 題目公布 +0～1h | Superpowers `brainstorming`：選**一個目標使用者 + 一句話需求**，查可用開放資料（逐一確認真的存在、看 CORS、要不要金鑰） | 一句話題目、使用情境、資料清單 |
| +1～1.5h | `writing-plans`：在 [10-architecture.md](10-architecture.md) 填實際架構、API 契約、bridge 訊息清單、分工 | 計畫 + 契約 |
| 第一小時內（平行） | **建公開 repo**、LICENSE（[templates/LICENSE_NOTICE.txt](templates/LICENSE_NOTICE.txt)）、README 骨架、空殼部署（web + api）+ App destinationUrl 打通 | 端到端打通 |
| 開發 | 前端（mock 先行）／後端（資料清洗 + API）／App（自訂 Handler、預設置頂、INTERNET 權限）平行 | |
| 每 2–3h | 部署 + App 內實測整條流程；`git pull` 合併一次 | |
| 半夜 | 輪流睡；至少一人醒著顧部署與合併 | |
| 11/8 07:30 | **功能凍結**；README、資料來源、套件授權、AI 揭露；Demo 彩排 3 次；飛航模式測（若有 AI） | 可繳交 |
| 11/8 **09:00 前** | **上傳作品到主辦作品系統**（建議 08:30 前完成） | 已上傳 |

原則：**功能聚焦、做得穩定**。一條完整主流程 > 多個半成品。

## 發表腳本與評分對照
→ 見 [12-scoring-playbook.md](12-scoring-playbook.md)：初選 2 分鐘＋Q&A 1 分鐘（輪桌、會評兩次）、決選 5 分鐘＋Q&A 5 分鐘、11/8 時程倒推、最後檢查表。
- 用 01 的**六面向**（安全/創新/有感/參與/便利/透明）各準備一兩句。
- 每位隊員要能解釋自己負責的程式（AI 寫的也要讀過）。

## 投影實機畫面（不能用簡報）
- 決選：**自帶 Demo 筆電**，派一人到控台區操作；控台**只提供 HDMI 線**，轉接頭自備；13:30–14:10 有設備測試時間。
- **Android（隊伍決定：用 Android Studio）**：手機開 USB 偵錯接筆電 → Android Studio 開 **View › Tool Windows › Running Devices**，按「+」選實機即可鏡像（Settings › Tools › Device Mirroring 可勾「連接實機時自動鏡像」）→ 筆電接 HDMI 投影。
  - 可以直接在鏡像視窗用滑鼠操作，也可以拿手機操作。
  - Running Devices 視窗拉成浮動視窗後放大，其他面板收起來，畫面才會乾淨。
  - 無線版：手機開「無線偵錯」，在 Android Studio 用 Pair Devices Using Wi-Fi 配對（要同一個 Wi-Fi，現場網路不穩時改用 USB）。
  - 備案：`scrcpy`（`winget install Genymobile.scrcpy`）。
  - 賽前一定要用**發表那台筆電**試一次。
- **iPhone**：Mac 用 QuickTime「新增影片錄製」選 iPhone，或 AirPlay。
- 備案：錄一段完整操作影片，萬一現場網路掛掉可以補充說明（但主體仍要實機操作）。
- 上台前：先打一次後端 API 暖機（Cloud Run 冷啟動）、關掉手機通知干擾（勿擾模式，但別擋到我們自己的 notify）、亮度調高、字體大小正常。

## 收尾繳交檢查
- [ ] repo 公開；LICENSE = AGPL-3.0 全文 + 主辦授權聲明
- [ ] 原始碼齊：web、backend、修改後的 TownPass
- [ ] README 照著能跑（[templates/README_TEMPLATE.md](templates/README_TEMPLATE.md)）
- [ ] 資料來源清單（含模擬資料標示）
- [ ] 第三方套件 + 授權清單（沒有 Google Maps / Mapbox）；圖片、字型、圖示素材來源
- [ ] AI 揭露（開發用的工具；執行時若有模型：名稱/版本/量化/框架/來源）
- [ ] Dockerfile、.env.example，**無金鑰外洩**（`git log -p | grep -i key` 檢查一次）
- [ ] 賽前準備的骨架（bridge、Dockerfile、測試頁）在 README 註明
- [ ] Demo 手機：App 已裝、服務在「我的服務」預設置頂、網路 OK、（AI）模型已預熱
