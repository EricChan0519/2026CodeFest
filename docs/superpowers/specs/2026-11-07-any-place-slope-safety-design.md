# 改版設計：任意地點、DTM 坡度、監視器與派出所、箭頭依路徑轉彎

日期：2026-11-07 17:10。已和 Daniel 確認設計。這份文件是**這次改版的依據**；[docs/arrow-nav/](../../arrow-nav/README.md) 的 01–05 已依此更新。實作計畫尚未依改版更新。

## 1. 為什麼改

| 需求 | 原本 | 改成 |
|---|---|---|
| 目的地 | 只能選公車站牌 | 搜尋任何地點；公車站牌是其中一種 |
| 長者坡度 | 16:10 放棄（Valhalla 內建高程含建物，平地算出 56 公尺爬升，見 [verification.md](../../arrow-nav/verification.md)） | 用**內政部 20 公尺網格 DTM**（不含建物的地形） |
| 箭頭 | 實測看起來一直指著終點 | 先指第一段，走到轉彎處才指下一段 |
| 安全考量 | 只有路燈、無燈路口 | 加上**監視器、派出所**；繞路上限更嚴 |

## 2. 已定案的決定

| 問題 | 決定 |
|---|---|
| 怎麼選目的地 | **只有搜尋框**，下面列「最近去過」；不放地圖。「附近公車站」保留成次要按鈕（已做好） |
| 公車站牌 | 保留成一種目的地（`kind: "bus_stop"`），仍進 P4 分方向選站位 |
| 監視器／派出所的繞路上限 | 比最快路線**多 20% 以內，且不超過 200 公尺** |
| 監視器／派出所套用範圍 | **晚上全部對象＋兒童全天**；長者白天以坡度為主 |
| 地址查詢 | 不做任意門牌查詢（OSM 門牌不完整，要接外部 geocoder），列「留到之後」 |

## 3. 資料

| 用途 | 來源 | 授權 | 形式 | 處理 |
|---|---|---|---|---|
| 地點 | OpenStreetMap（Overpass，臺北範圍） | ODbL | 有 `name` 的 amenity、shop、tourism、leisure、office、healthcare、車站 | `scripts/build_places.py` → `api/data/places.json` |
| 公車站 | 既有 `api/data/stop_index.json` | TDX | 已有 | 搜尋時合併 |
| 高程 | [內政部 20 公尺網格 DTM](https://data.gov.tw/dataset/35430) | 政府資料開放授權第 1 版 | CSV，平面坐標＋高程（坐標系看 `schema_hdr.csv`，預期 TWD97） | `scripts/build_elevation.py` → `api/data/elevation_grid.bin`＋`.json`；`routing/elevation/N24E121.hgt`、`N25E121.hgt` |
| 派出所 | [臺北市政府警察局名稱及地址](https://data.gov.tw/dataset/130095) | 政府資料開放授權第 1 版 | CSV 112 筆，**只有地址** | 先比對 OSM `amenity=police`，比不到用 Nominatim |
| 監視器 | [臺北市政府警察局錄影監視系統設置區位](https://data.gov.tw/dataset/130094) | 政府資料開放授權第 1 版 | CSV 約上萬筆，**只有地址**＋攝影方向 | 依地址去重，Nominatim 只收門牌層級結果 |

- 地址轉座標**只在建置時**由腳本做，結果進快照；執行時不呼叫外部服務，使用者位置不送第三方（ADR-0004、ADR-0005）。
- Nominatim：每秒最多 1 次、User-Agent 用專案名稱（不放個人信箱）、結果快取在 `scripts/.cache/geocode.json`（不進 repo），中斷可續跑。
- 20 公尺網格看不到天橋、地下道，文件與關於頁要寫明。

## 4. 後端

### 4.1 地點搜尋

`GET /api/places/search?q=`（`q` 1–50 字）。不傳使用者座標，前端自己算距離。

```json
{
  "places": [
    { "placeId": "osm:n123", "kind": "place", "category": "medical",
      "name": { "zh": "範例醫院", "en": "Example Hospital" }, "lat": 25.1, "lon": 121.5, "stationUid": null },
    { "placeId": "stop:TPE12345", "kind": "bus_stop", "category": "bus_stop",
      "name": { "zh": "範例站", "en": "Example Stop" }, "lat": 25.1, "lon": 121.5, "stationUid": "TPE12345" }
  ],
  "sources": [ { "name": "OpenStreetMap", "updatedAt": "2026-11-07" }, { "name": "TDX 公車站位資料", "updatedAt": "2026-11-07T15:59:00+08:00" } ]
}
```

- `category`：`medical`、`school`、`station`、`park`、`government`、`shop`、`food`、`tourism`、`bus_stop`、`other`。
- 排序：完全相同 > 開頭相同 > 包含；同級時 `station`、`medical`、`government` 在前；再比名稱長度。最多 20 筆。
- 同名公車站位合成一筆（一個 `stationUid`），選了以後進 P4。

### 4.2 路線：規則表改成「目標」

候選不再是「一組權重算一次」，而是**先產生一批路線，全部量測，再依目標挑一條**。Valhalla 不能直接偏好某些點（監視器、派出所），只能這樣做。

| 對象 | 白天 | 晚上 |
|---|---|---|
| 長者 | `flattest` | `flattest_watched` |
| 兒童 | `fewer_unsignalized_watched` | `fewer_unsignalized_watched_bright` |
| 外籍人士 | `fastest`（只有一條） | `watched_bright` |

每個目標都附一條 `fastest` 比較。

| 目標 | 產生路線（每組都要 `alternates: 2`） | 挑選順序 |
|---|---|---|
| `flattest` | 少坡（`use_hills` 0.0）＋少階梯；最快 | 爬升 → 階梯 → 最陡坡度 → 距離 |
| `flattest_watched` | 同上＋較亮 | 爬升差 2 公尺內視為相同，再比監視分數 |
| `fewer_unsignalized_watched` | 少過無燈路口權重；最快 | 無燈路口 → 監視分數 → 距離 |
| `fewer_unsignalized_watched_bright` | 同上＋較亮 | 無燈路口 → 監視分數（含路燈）→ 距離 |
| `watched_bright` | 最快；較亮；偏好人行道 | 監視分數（含路燈）→ 距離 |

- **監視分數** = 每 100 公尺監視器數 + 2 ×（150 公尺內派出所數）；名稱有 `bright` 時再加 3 × `litRatio`。係數放在 `route_rules.py` 頂部。
- **繞路上限：** 目標名稱有 `watched` 時，多 20% 以內且不超過 200 公尺；其他維持 300 公尺／1.5 倍。超過上限的路線**不參加挑選**；沒有路線符合，就推薦 `fastest` 並加 `no_better_route`。
- 去重、「量得到改善才給原因」規則不變。
- `candidate` 有值（重算）：只產生並挑選那個目標。

### 4.3 量測（`metrics.measure`）

| 欄位 | 算法 |
|---|---|
| `climbM` | 每 20 公尺從高程網格雙線性取值；上升超過 1 公尺的遲滯才累計（濾掉網格雜訊） |
| `maxGradePct` | 40 公尺視窗內最大的（高差 ÷ 40）× 100，取到 0.1 |
| `cameras` | 路線 30 公尺內的監視器數 |
| `policeNearby` | 路線 150 公尺內的派出所數 |

快照不存在時欄位是 `null`，不丟例外（沿用現有規則）。

### 4.4 原因代碼（新增）

| 代碼 | 條件 | zh-TW |
|---|---|---|
| `flatter` | `climbM` 少 2 公尺以上（改用 DTM 真實數字） | 少爬 {n} 公尺的坡 |
| `gentler_slope` | `maxGradePct` 少 2 以上 | 最陡的地方比較緩 |
| `more_cameras` | `cameras` 多 3 支以上 | 沿路監視器多 {n} 支 |
| `near_police` | `policeNearby` 比最快路線多 | 會經過派出所附近 |

用詞規則不變：不寫「安全路線」。

## 5. 前端

- **首頁 P2：** 大搜尋框；「最近去過」最多 5 筆（localStorage）；次要按鈕「附近公車站」。
- **搜尋結果 P3：** 地點和公車站混在一起，前面有分類圖示；公車站 → P4，地點 → P5。
- **抵達 P7：** 公車站「到了，在這裡等 307」；地點「到了，這裡是 {name}」。

## 6. 箭頭依路徑轉彎

**現象：** 實測時箭頭看起來一直指著終點。

**推測原因（要先重現確認）：** `NavLab.vue` 真實模式第一次用合成路線（`twoLegRoute`），走偏後 `straightRoute()` 退回直線連到終點。另一個會讓箭頭在轉角亂指的原因：目標點最多只到轉彎點，GPS 已經過了轉角、投影還沒過時，目標點在使用者背後。

**規格：**
1. 目標點 = 沿路線往前 `lookaheadM`（20 公尺），不超過下一個轉彎點。
2. 離轉彎點 `turnPassM`（`max(8, 0.5 × accuracyM)`）以內，或沿路線距離已超過轉彎點，這個轉彎**算已通過**，目標點改成下一段的前視點。通過後不會退回。
3. 轉彎前 30 公尺顯示並播報「前面路口向左轉」（不變）。
4. 重算一律呼叫 `POST /api/routes`（帶目前的 `candidate`）；失敗進 `back_to_route`，箭頭指最近的路線點。**正式流程不使用 `straightRoute()`。**

## 7. 驗證關卡

| ID | 負責 | 內容 | 期限 | 沒通過 |
|---|---|---|---|---|
| V4 | API-B | DTM 轉 `.hgt`，routing 重建；同一段平地路線爬升 < 5 公尺；`use_hills` 0.0 會換路 | 20:00 | 只用自己的高程網格量測並挑選，routing 不重建 |
| V5 | API-A | 監視器地址轉座標的覆蓋率（以去重後地址計） | 20:00 | 低於 50% 就不用監視器，只留派出所和路燈 |

## 8. 來不及時怎麼砍

依序移除：監視器 → 派出所 → 兒童目標 → `gentler_slope`。**坡度最後才砍。**

## 9. 不做

地圖選點、任意門牌地址、外部 geocoder 即時查詢、聲控輸入、新北市資料。
