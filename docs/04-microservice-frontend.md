# 04 · 微服務前端

## 官方範例 TownPass-Services
`reference/TownPass-Services/`（github.com/taipei-doit/TownPass-Services，最後更新 2025-01）
- 技術：**Vue 3.4 + Vite 5 + TypeScript + Tailwind 3 + Pinia + vue-router + axios + @vueuse/core + date-fns + headlessui**
- 啟動：`pnpm install` → `pnpm dev`（http://localhost:5173），mobile-first，用 DevTools 裝置模擬看
- ⚠️ 它用 `vue3-google-map` / `@googlemaps/*` → **今年禁用**，地圖要換 Leaflet / MapLibre
- 已上線網址（App 內預設服務指向這裡）：`https://taipei-pass-service.vercel.app/`（申辦、有話要說、臨櫃叫號、災情通報、圖書借閱、找地點 等路徑）

```
src/
├─ views/        每頁一個 view（對應 router）——**雙向溝通 hook 只在 view 呼叫**
├─ components/   atoms / molecules / organisms（atomic design）
├─ composables/  useConnectionMessage.ts、useHandleConnectionData.ts
├─ stores/       Pinia（user store 存 userinfo）
├─ router/  css/  utils/  enums/  interfaces/
public/mock/     各服務 mock JSON（case_progress, counter_list, coupon_data…）
```
11 個官方微服務 UI 可參考流程與畫面：申辦服務、找地點、Q&A、優惠券、臨櫃叫號、市政訊息訂閱、有話要說、災情通報、警政報案、圖書館、繳費。文件 `tpe-guideline.web.app/docs/micro-service/<name>/`。

### Tailwind 色票（官方範例 tailwind.config.js）
注意：範例的 `primary.500` 是 `#2eb6c7`，與 App 的 `#5AB4C5` 不同；**我們統一用 App 的 TPColors**（見 02）。字型 `'PingFang TC','Roboto',…`；`boxShadow.card: 0 4px 12px rgba(0,0,0,.1)`；警示色 `warn: #ea686f / #e5464b`。

## 框架選擇
語言框架不限（Vue 3 官方、React、純 HTML 都可；即時雨晴就是 Flask + 純 HTML/JS）。選隊員最熟的。
- 我們的練功專案 `專案資料夾/codefest2026`（城市水路）已用 **Vue 3.5 + Vite 8 + TypeScript + Tailwind 4 + Leaflet 1.9 + vue-router**，隊上最熟 → 預設沿用（見 [10](10-architecture.md) D1）。
- 官方範例是 Tailwind 3、Vite 5；要抄官方元件時注意 Tailwind 3→4 設定寫法不同（4 用 `@tailwindcss/vite` + CSS `@theme`，沒有 `tailwind.config.js`）。

## 開源地圖
| 套件 | 授權 | 用途 |
|---|---|---|
| Leaflet | BSD-2 | 最簡單，點位/marker cluster（`leaflet.markercluster` MIT） |
| MapLibre GL JS | BSD-3 | 向量圖磚、3D、效能好 |
| 圖資 | OpenStreetMap (ODbL，需標示 © OpenStreetMap contributors) / 國土測繪中心 NLSC WMTS | |

### 圖磚網址（2026-11-04 實測都回 200）
```js
// 國土測繪中心 臺灣通用電子地圖（注意：路徑是 {z}/{y}/{x}，y 在 x 前面）
L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
  attribution: '&copy; <a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>', maxZoom: 19,
});
// OpenStreetMap（官方圖磚只適合低流量，Demo 夠用；要標示 attribution）
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
});
```
- 國土測繪中心是政府圖資、中文地名完整，**符合「國土測繪中心圖資」的規則字面**，建議預設用它，OSM 當備援。
- NLSC 還有其他圖層（例如 `PHOTO2` 正射影像、`EMAP5` 等），換路徑裡的圖層名即可，用前先測。

### Leaflet 在 Vite／WebView 的常見坑
- 要 `import 'leaflet/dist/leaflet.css'`，不然圖磚會亂排。
- Vite 打包後預設 marker 圖示會 404 → 自己 import 圖檔設 `L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })`，或改用 `L.divIcon`／`circleMarker`。
- 地圖容器一定要有明確高度；放在會切換顯示的區塊時，顯示後呼叫 `map.invalidateSize()`。
- 定位用 `location` handler 拿座標，不要用 Leaflet 的 `map.locate()`（瀏覽器版定位在 WebView 權限行為不一致）。
- 外部導航可用 `launch_map` 傳 OSM 或地圖 URL（例如 `https://www.openstreetmap.org/directions?to=lat,lng`）。
- 圖表建議開源：ECharts (Apache-2.0)、Chart.js (MIT)。
- 圖示：練功專案用 `@phosphor-icons/vue`（MIT）；或直接用 TownPass `assets/svg/` 的 108 個圖示（GPL-3.0，同專案可用）。

## WebView 注意事項
- 切頁/背景時釋放資源；避免記憶體爆。
- iOS 預設擋彈窗、Android 要自理 → 雙平台都測。
- 開發用 DevTools 裝置模擬 + mock，最後**一定在 App 內實測**（雙向溝通只在 App 內有效）。
- 網頁 `<title>` 會成為 App AppBar 標題。
- 部署必須 HTTPS；SPA 要設 rewrite 到 index.html（Firebase init 時選 SPA = Yes）。
- 觸控目標 ≥ 48px、文字放大 200% 版面不壞。
- WebView 上方已有 App 的 AppBar（primary500 底、白字、返回鍵）→ 網頁**不要再做一條標題列**，直接從內容開始。
- **直接從前端打開放資料要先看 CORS**：data.taipei API 只允許 `https://data.taipei` 跨域 → 前端打不到，要走後端；YouBike 即時 JSON 是 `*`，前端可直打（見 [07](07-open-data.md)）。
- 開發時 Vite 經 tunnel（cloudflared／ngrok）給手機看，要在 `vite.config` 設 `server: { allowedHosts: true }`（或列出 tunnel 網域），否則會被 Vite 擋。
