# 架構審查

依 ISO/IEC 25010 品質屬性與 EA 原則，審查第一版設計（Kotlin 原生羅盤、雙路網 OSRM、最快與安全兩條固定路線），以及目前的版本。

## 結論

**Verdict：Approved with changes。** 下表的修正都已寫進文件，只有 16:30 的三項驗證還沒有結果。

最優先的三件事：

1. 16:30 前用實體手機確認羅盤和定位。
2. 16:30 前確認 Valhalla 能部署，並量映像大小。
3. 全站用詞不能宣稱安全或無障礙。

## 做得好的地方

- App 很薄，只有隊長要碰 Flutter，其他人不被環境卡住。
- 沒有資料庫，服務無狀態，容易移交。
- 合約先行，前後端可以用 mock 平行開發。
- 全部開源，符合比賽規則。

## 發現與修正

### Critical

| # | 發現 | 證據 | 修正 | 狀態 |
|---|---|---|---|---|
| C1 | 宣稱「安全路線」或「無障礙路線」會誤導弱勢使用者 | OSM 有 `sidewalk` 標籤的車道只有約 6%；路口有約 7,428 個屬性不明 | 改用具體說法；原因必須量得到；[ADR-0006](decisions/0006-recommend-routes-with-measured-reasons.md) | 已修正 |
| C2 | 使用者座標可能外洩 | Cloud Run 請求紀錄保留網址；App 的 listener 沒有 `allowedOriginRules` | 座標放 POST body、不進 log；新 Handler 檢查來源；[ADR-0005](decisions/0005-keep-location-out-of-urls-and-logs.md) | 已修正 |
| C3 | Demo 有單點故障 | 評審可能關網路；Cloud Run 有冷啟動；頁面本身也要網路才打得開 | 路線取得後離線；內建 Demo 路線；前端預先快取；暖機；[ADR-0007](decisions/0007-keep-navigation-engine-in-web.md) | 已修正 |

### Major

| # | 發現 | 證據 | 修正 | 狀態 |
|---|---|---|---|---|
| M1 | 第一版用 Kotlin 原生羅盤，只支援 Android，也不符合既有架構 | 專案以 WebView 為主；只有隊長有 Flutter 環境；Demo 可能換手機 | 網頁能力優先，備案是 Flutter 跨平台 Handler；[ADR-0003](decisions/0003-use-web-sensors-first.md) | 已修正，待 V1、V2 |
| M2 | 導航和感測、畫面綁在一起就無法測試 | 羅盤與 GPS 無法在 CI 重現 | `SensorSource` 介面；`nav/` 純函式；回放測試 | 已修正 |
| M3 | 路徑引擎格式外洩會讓備案失去意義 | Valhalla 和 OSRM 的回應與座標順序都不同 | 只在 adapter 轉換；API 回 `[lat, lon]` | 已修正 |
| M4 | 雙路網 OSRM 無法依使用者和時間調整 | 每種情境都要一份路網和映像 | Valhalla 每次查詢調權重；[ADR-0002](decisions/0002-use-valhalla-for-walking-routes.md) | 待 V3 |
| M5 | 外部資料在請求時下載會拖慢且不穩 | 施工資料下載約 8 秒；路燈檔 51 MB | 建置時產生快照；施工資料移出範圍；[ADR-0004](decisions/0004-serve-open-data-from-snapshots.md) | 已修正 |
| M6 | 施工資料含個資 | 欄位有承辦人姓名和電話 | 目前不使用；要用時只留白名單欄位（[07](../07-adding-tech.md)） | 已修正 |
| M7 | 感測生命週期沒有定義 | Handler 是快取單例；iOS 權限要按鈕觸發 | `requestPermission`、`stop`、`pagehide`；Handler 防重複訂閱、30 分鐘自動停止 | 已修正 |
| M8 | 第一版沒有可量測的品質目標 | 只有形容詞 | [arc42 §10](arc42.md#10-品質情境) 的 10 個情境 | 已修正 |
| M9 | 三種對象做成三套畫面會做不完 | 只有 2 位前端，17 小時 | 對象是設定；共用畫面 | 已修正 |

### Minor

| # | 發現 | 修正 |
|---|---|---|
| m1 | TWD97 和 WGS84 容易混用 | TWD97 只出現在腳本 |
| m2 | `lat`、`lon` 順序容易錯 | 合約統一；OSRM 的順序只在 adapter |
| m3 | 羅盤是磁北，路線方位是真北 | `declinationDeg` 放在設定 |
| m4 | 冷啟動時無法判斷整條路徑是否正常 | `/api/health?deep=1` |
| m5 | 流量失控可能產生費用 | 設定 `--max-instances` |
| m6 | Valhalla 映像可能超過 Artifact Registry 免費額度 | V3 記錄大小，隊長決定 |

### Suggestion

| # | 建議 |
|---|---|
| s1 | 路徑服務之後可改成 Cloud Run sidecar，少一次網路呼叫 |
| s2 | 取得 Mac 後跑 iOS 驗證（I1） |
| s3 | `routing` 改成 IAM 保護（I2） |
| s4 | 用 GitHub Actions 定期更新快照，降低維運負擔 |

## 依品質屬性檢視

| 屬性 | 評估 |
|---|---|
| 功能適合性 | 主流程完整；候選路線可分段砍 |
| 效能 | 箭頭在本機算，不受網路影響；路線 API 依賴 Cloud Run 冷啟動 |
| 相容性 | 同一份網頁跑在 WebView 和瀏覽器；**iOS 未驗證** |
| 易用性 | 畫面極簡；8 種語言；語音和震動。翻譯品質是最大未知 |
| 可靠性 | 離線導航；快照；每個失敗都有畫面。Demo 手機是單點，要有第二支 |
| 安全性 | 無帳號、無資料庫、位置不留存。`routing` 公開是接受的風險 |
| 可維護性 | adapter、純函式導航、單一規則表 |
| 可攜性 | Dockerfile、無雲端專屬服務 |
| 過度設計檢查 | 沒有資料庫、佇列、微服務拆分；路徑服務獨立是因為映像和記憶體需求完全不同 |
