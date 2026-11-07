# START HERE — 組員環境建置指引（給你的 AI 讀）

> **組員**：把這整包解壓縮到一個**全英文路徑**的資料夾（例如 `C:\dev\townpass-kit`），用你的 AI 工具（Claude Code、Cursor、Copilot…）打開，跟它說：
> 「讀 START_HERE.md，幫我檢查並建好環境，最後給我回報表。」
>
> **AI**：以下是給你的工作說明，請依序執行。

---

## 0. 給 AI 的規則
1. 先讀完本檔，再讀 `CLAUDE.md`（比賽規則摘要與已知的坑）。其他細節在 `docs/`。
2. **只裝必要的東西**（第 2 節）。每一步先檢查是否已經有了，版本對就跳過。
3. **安裝任何軟體前先列出要裝什麼、從哪裡裝，等使用者同意**。不要改作業系統的安全設定。
4. 不要建立、要求或寫入任何金鑰／密碼。
5. 每一步做完要**實際跑指令驗證**；失敗就排除，排除不了記到回報表，不要假裝成功。
6. 電腦可能是 Windows 或 macOS，指令依作業系統選用。
7. 賽前只建環境、跑樣板，不要開始寫比賽功能。

## 1. 背景（30 秒版）
- 比賽：2026 臺北秋季程式設計節 城市通微服務大黑客松，**11/7（六）–11/8（日）天母**，題目當天公布。
- 我們要在「城市通」App 裡加一個**微服務**：在 App 的 WebView 裡跑的**網頁**＋後端。
- **App（Flutter）只由隊長 build**。組員只寫網頁或後端，**不需要 Flutter、Java、Android Studio**。網頁部署後，App 裡打開的就是新版，不用重 build App。

| 部分 | 技術 | 負責 |
|---|---|---|
| 微服務前端 | **Vue 3 + Vite + TypeScript + Tailwind CSS 4** | 前端組員 |
| 地圖 | **Leaflet + 國土測繪中心圖磚**（禁止 Google Maps／Mapbox） | 前端組員 |
| 後端 | **FastAPI**（Python），Cloud Run | 後端組員 |
| App 端 | Flutter（TownPass fork） | 隊長 |
| 部署 | 前端 https://townpass-hackathon-2026.web.app 、網頁的 `/api/**` 轉到後端 | 指定一人統一部署 |

## 2. 必要環境
| 工具 | 誰需要 | Windows（winget） | macOS（Homebrew） |
|---|---|---|---|
| Git | 全員 | `winget install Git.Git` | `brew install git` |
| VS Code（或其他編輯器） | 全員 | `winget install Microsoft.VisualStudioCode` | `brew install --cask visual-studio-code` |
| Chrome | 全員 | `winget install Google.Chrome` | `brew install --cask google-chrome` |
| Node.js 20 以上 | **前端** | `winget install OpenJS.NodeJS.LTS` | `brew install node` |
| Python 3.12 以上（含 pip） | **後端** | `winget install Python.Python.3.13` | `brew install python@3.13` |
| VS Code 擴充 | 前端：`Vue.volar`、`bradlc.vscode-tailwindcss`、`dbaeumer.vscode-eslint`、`esbenp.prettier-vscode`；後端：`ms-python.python` | `code --install-extension <ID>` | 同左 |

**不需要**：Flutter、Java、Android Studio、Docker、Firebase CLI、gcloud（除非被指定負責部署，見 3-D）。

## 3. 執行步驟

### A. 盤點現況
```bash
git --version
node -v
python --version
code --list-extensions
```
（Windows 若 `python` 叫不出來，試 `py --version`。）把結果整理成表格（有／版本／缺）。

### B. 補齊缺的（先問再裝）
依第 2 節表格，只裝這位組員角色需要的。

### C-1. 前端組員：起手式測試（Vue 3 + Tailwind 4 + Leaflet）
在一個全英文路徑下：
```bash
npm create vite@latest web-smoke -- --template vue-ts
cd web-smoke
npm install
npm install leaflet
npm install -D @types/leaflet tailwindcss @tailwindcss/vite
```
- `vite.config.ts` 的 plugins 加 `tailwindcss()`（`import tailwindcss from '@tailwindcss/vite'`）；`src/style.css` 換成 `@import "tailwindcss";`。
- `src/App.vue` 放一個高度 400px 的地圖，`import 'leaflet/dist/leaflet.css'`，圖磚用國土測繪中心（**路徑 y 在 x 前面**）：
  ```ts
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    attribution: '&copy; 內政部國土測繪中心', maxZoom: 19,
  })
  ```
  中心點 `[25.0375, 121.5637]`、zoom 15。
- `npm run dev` → 瀏覽器開 http://localhost:5173 看到臺北市政府附近的地圖、Tailwind class 有作用，就算成功。
- Chrome DevTools 切到手機模擬（Ctrl+Shift+M）確認版面。
- 讀 `docs/03-two-way-communication.md`；比賽時和 App 溝通一律用 `docs/templates/townpass-bridge.ts`（瀏覽器下會回 mock 資料，不用 App 也能開發）。

### C-2. 後端組員：起手式測試（FastAPI）
```bash
cd prep-deploy/api
python -m venv .venv
```
啟用 venv（Windows：`.venv\Scripts\activate`；macOS：`source .venv/bin/activate`），然後：
```bash
pip install -r requirements.txt
uvicorn main:app --port 8080
```
瀏覽器開 `http://localhost:8080/api/health`，要回 `{"ok":true,"revision":"local"}`。再開 `http://localhost:8080/docs` 看得到 Swagger 頁面。
- 讀 `docs/05-backend-and-deploy.md`、`docs/07-open-data.md`（data.taipei 要經後端、TDX／氣象署金鑰只放後端）。
- 試打一個開放資料：`https://data.taipei/api/v1/dataset/a6e90031-7ec4-4089-afb5-361a4efe7202?scope=resourceAquire&limit=1` 要回 JSON。

### D. 只有被指定負責部署的人
- 裝 Firebase CLI：`npm install -g firebase-tools` → `firebase login` → `firebase projects:list` 要看得到 `townpass-hackathon-2026`（看不到代表還沒接受隊長寄的 Firebase 邀請信）。
- 部署後端的人再裝 gcloud（Windows `winget install Google.CloudSDK`；macOS `brew install --cask google-cloud-sdk`）→ `gcloud auth login` → `gcloud config set project townpass-hackathon-2026`。
- **不要**對正式網址 `firebase deploy`（會蓋掉隊長的測試頁）。要試部署用預覽頻道：在 `prep-deploy/web` 執行 `firebase hosting:channel:deploy <你的名字> --expires 1d`。

### E. Claude Code 使用者（選配）
隊伍用 **Superpowers** 外掛（brainstorming → writing-plans → 分工實作）。請使用者在互動式 `claude` 終端機自己執行：`/plugin marketplace add obra/superpowers-marketplace`，再 `/plugin install superpowers@superpowers-marketplace`。

## 4. 最後產出回報表
```
【環境回報】姓名：____　角色：前端 / 後端 / 部署　電腦：Windows / macOS
| 項目 | 狀態 | 版本／備註 |
|---|---|---|
| Git | ✅/❌ | |
| VS Code + 擴充 | ✅/❌ | |
| Node.js（前端） | ✅/❌/不需要 | |
| Vue + Tailwind + Leaflet 地圖 | ✅/❌/不需要 | |
| Python（後端） | ✅/❌/不需要 | |
| FastAPI /api/health | ✅/❌/不需要 | |
| Firebase 看得到專案（部署者） | ✅/❌/不需要 | |
| 有沒有 Android 手機 | 有/沒有 | 有的話向隊長拿測試 APK |
| 卡住的問題 | | |
```

## 5. 組員本人要做的（AI 做不了）
- 帶**政府核發證件**（報到查驗，沒帶不能參賽）。
- 把 GitHub 帳號傳給隊長（開 repo 時加 collaborator）；負責部署的人另外接受 Firebase 邀請信。
- 讀一遍 `docs/01-competition-rules.md`（規則）、`docs/12-scoring-playbook.md`（**評分 → 實作對照**，作品 11/8 09:00 前上傳）與 `docs/09-hackday-playbook.md`（當天流程）。
- 挑 `docs/07-open-data.md` 的一兩個主題逛資料集，記下名稱、連結、更新頻率、有沒有座標。
