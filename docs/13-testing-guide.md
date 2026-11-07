# 13 · 開發中怎麼測試（UI 與功能）

> 給前端、後端組員：寫到一個段落，想看畫面或確認功能有沒有正常時照這份做。
> 三種方式由快到慢：**① 電腦瀏覽器**（隨時）→ **② 自己的手機瀏覽器**（看真機版面）→ **③ 城市通 App 裡**（測 App 能力，交給隊長）。

## 先知道兩件事
- **版面在手機瀏覽器正常，在 App 裡基本也正常**：城市通的 WebView 在 iPhone 是 WKWebView（＝Safari 內核），在 Android 是 Chrome 內核。
- **App 能力只有在 App 裡才是真的**：`userinfo`、`location`、`notify`、`qr_code_scan` 等（`flutterObject`）。在一般瀏覽器裡，bridge（`townpass-bridge.ts`）會回 mock：定位固定在臺北市政府、使用者是「金大森」，推播不會有反應。
- iOS 版 App 要 Mac 才能 build → 沒有 Mac 的人，App 內測試一律用**隊長的 Android**（③）。

## ① 電腦瀏覽器（最快，平常都用這個）
開兩個終端機：
```bash
# 後端
cd api
python -m venv .venv              # 第一次才需要
.venv\Scripts\activate            # macOS：source .venv/bin/activate
pip install -r requirements.txt   # 第一次才需要
uvicorn main:app --reload --port 8080

# 前端
cd web
npm install                       # 第一次才需要
npm run dev
```
- 開 http://localhost:5173 → F12 → **Ctrl+Shift+M**（裝置模擬）→ 選 iPhone 等 375px 寬的機型。
- 存檔後畫面自動更新；前端的 `/api/...` 會由 Vite proxy 轉到本機 `:8080`（`vite.config.ts` 已設好）。
- 後端 API 也可以直接在 http://localhost:8080/docs（Swagger）試打。
- 檢查：手機寬度不破版、loading／錯誤／空資料畫面都有、Console 沒有紅字。

## ② 自己的手機瀏覽器（看真機版面、觸控、地圖手勢）
### 方法 A：同一個 Wi-Fi 直接連電腦（改了馬上看到）
```bash
cd web
npm run dev -- --host
```
- 終端機會印出 `Network: http://192.168.x.x:5173` → 手機（iPhone 用 Safari、Android 用 Chrome）開這個網址。
- Windows 第一次會跳防火牆提示 → 選「允許」（私人網路）。
- 後端照 ① 在電腦上跑，手機上的 `/api` 也會經電腦轉到本機後端 → **新寫的 API 也能測**。
- 看：字級、按鈕好不好按（≥ 48px）、瀏海／底部安全區、捲動、地圖拖曳縮放。
- 連不上：多半是場地 Wi-Fi 擋裝置互連 → 改用方法 B，或手機開熱點讓電腦連。

### 方法 B：Firebase 預覽頻道（HTTPS 網址，可以傳給隊友）
```bash
cd web
npm run build
firebase hosting:channel:deploy <你的名字> --expires 1d
```
- 會得到 `https://townpass-hackathon-2026--<你的名字>-xxxx.web.app`，手機直接開。
- ⚠️ **不要**跑 `firebase deploy`（會蓋掉正式站）。
- ⚠️ 預覽頻道的 `/api` 接的是**雲端 Cloud Run 上的後端**，不是你電腦上的 → 你新寫的 API 要等負責部署的人部署 Cloud Run 之後才有。只改前端時沒影響。
- 要先被加進 Firebase 專案成員、`firebase login` 過才能部署。

## ③ 城市通 App 裡（測 App 能力：定位、推播、使用者資料、掃碼）
- 隊長手機上的 App，服務網址指向雙向溝通測試頁（https://townpass-hackathon-2026.web.app）。
- 你把**方法 B 的預覽網址**傳給隊長 → 他在測試頁的「前往網址」貼上就跳過去，**不用重 build App**，bridge 照樣能用。
- 隊長用電腦 Chrome 開 `chrome://inspect` 看手機 WebView 的 Console 和網路請求。
- 每 2～3 小時整合測一次；Demo 前一定要在 App 裡完整走過主流程。

## iPhone 上看 Console 的問題
- Safari 的網頁檢查器只能接 **Mac** 看；Windows 看不到 iPhone 上的錯誤訊息。
- 替代：iPhone 測版面就好，JS 錯誤在 ① 電腦瀏覽器重現；或請隊長在 Android 上用 `chrome://inspect` 看。

## 什麼時候用哪一種
| 想確認 | 用 |
|---|---|
| 畫面、邏輯、API 串接 | ① |
| 真機字級、觸控、地圖手勢、安全區 | ② 方法 A |
| 給隊友或隊長看、在 App 裡測 | ② 方法 B → ③ |
| 定位、推播、使用者資料、掃碼是不是真的能用 | ③ |
