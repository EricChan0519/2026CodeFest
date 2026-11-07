# 07 · 加入新技術

隊友可以加技術，但要先通過下列檢查。**23:00 前不開始範圍外的新技術**，除非負責人自己的階段 1 項目已經完成。

## 加入前檢查

- [ ] 解決的是 [01](01-product-spec.md) 裡的具體問題，說得出對應的題目方向或評分項目
- [ ] 授權是 MIT、BSD、Apache-2.0 等開源免費授權
- [ ] 沒有授權費、訂閱費、付費功能，也不依賴第三方商用服務
- [ ] 不是 Google Maps、Mapbox
- [ ] 如果有 AI：執行時在裝置端，關網路也能用，模型不在資安黑名單，也不是大陸廠牌
- [ ] 失敗時主流程仍然能走完
- [ ] 導航畫面不會因此多一個元素；要加的話先和 UI 討論
- [ ] 不用改合約；如果要改，受影響的人都同意
- [ ] 能在凍結前完成，並有人能回答評審問題
- [ ] 已寫進 README，並在共編文件的登記表登記

## 接在哪裡

| 想加的東西 | 接在 | 規則 |
|---|---|---|
| 手機能力（NFC、藍牙、語音辨識、裝置端 AI） | `app/` 新增 Handler，`web/src/bridge/` 新增包裝 | 只用 Flutter 跨平台套件，不寫 Kotlin 或 Swift；Handler 檢查來源；網頁要有 mock |
| 新資料來源 | `api/app/adapters/` 新增 adapter | 欄位用白名單；有快照；在回應標示來源與時間 |
| 新路線候選或原因 | `api/app/route_rules.py` | 新增規則和原因代碼，並補上 8 種語言的文案 |
| 導航行為 | `web/src/nav/` | 維持純函式，補單元測試 |
| 新對象 | `web/src/audience.ts`、`api/app/route_rules.py` | 是設定，不是新畫面 |
| 前端元件或動畫 | `web/src/components/` | 符合易讀規則，低階手機也要順 |
| 新頁面 | `web/src/pages/` | 不增加主流程步驟 |
| 需要儲存資料 | 先討論 | 目前沒有資料庫；Cloud Run 上的檔案會消失，要儲存請先寫 ADR |

## 常見提案要注意什麼

| 提案 | 注意 |
|---|---|
| 今日施工繞路 | [資料](https://tpnco.blob.core.windows.net/blobfs/Todaywork.json)每 10 分鐘更新，下載約 8 秒，**不能在請求中同步抓**；是 TWD97 和民國日期；**含承辦人姓名電話，只留白名單欄位** |
| 到站時間 | TDX 要金鑰，只能放 Cloud Run 環境變數；TDX `Direction` 是車輛方向，不一定等於站牌方向，要實測 |
| 地圖 | 只能用 Leaflet 或 MapLibre 加 OSM 或國土測繪中心圖資，圖磚路徑是 `{z}/{y}/{x}`；不要放在導航畫面 |
| 裝置端 AI | 導航提示不要依賴 LLM，導航途中的延遲和錯誤風險太高 |

## 裝置端 AI

- 依 [`docs/06-on-device-ai.md`](../06-on-device-ai.md) 實作，走 Handler。
- 先確認隊上手機的記憶體與儲存空間。
- 要在飛航模式下實測。
- README 要揭露模型名稱、版本、量化格式、推論框架、來源。

## 重大決定

如果新技術會改變架構、資料儲存或合約，請在 `architecture/decisions/` 新增一份 ADR，並更新 [`workspace.dsl`](architecture/workspace.dsl) 和 [`arc42.md`](architecture/arc42.md)。
