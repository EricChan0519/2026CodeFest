# 連鎖店（便利商店、速食、餐廳）資料

導航實驗頁可以直接搜「全家」「麥當勞」「海底撈」「7-11」「kfc」，依離你（或臺北車站）的距離由近到遠列出分店。

## 資料來源

**Overture Maps Foundation — Places**（`theme=places/type=place`）

| 項目 | 內容 |
| --- | --- |
| 費用 | 免費；免帳號、免金鑰，直接讀公開的 S3／Azure |
| 授權 | CDLA-Permissive-2.0（Meta、Microsoft 等）、Apache-2.0（Foursquare）、CC0-1.0（AllThePlaces）；**不含 OpenStreetMap**，沒有 ODbL 的相同方式分享義務 |
| 與本專案 | AGPL-3.0 相容；要標示出處（頁面底部已標示來源、版本、授權） |
| 工具 | DuckDB（MIT）。不是 REST API，而是 GeoParquet；所以我們事先篩出台灣的連鎖店、存成靜態 JSON，使用者搜尋時不會連到任何第三方 |
| 官方文件 | https://docs.overturemaps.org/guides/places/ ・ https://docs.overturemaps.org/attribution/ |

## 為什麼不是別的

| 候選 | 結論 |
| --- | --- |
| Nominatim（OSM） | 免費、開源，但台灣連鎖店不齊（海底撈只回 2 家），一次只回幾筆，不能「找最近的」。保留給地址與地標 |
| Overpass API（OSM） | 免費、開源，可以查連鎖店；但公開伺服器有速率限制、ODbL 要標示並相同方式分享衍生資料庫，而且開發環境連不上。**可當備援**，目前不用 |
| 政府資料開放平臺「全國 5 大超商資料集」 | 免費、政府資料開放授權條款第 1 版；但只有公司登記地址，**沒有經緯度**，也沒有餐廳 |
| 7-ELEVEN、全家的官方店舖地圖 API | 沒有公開的使用條款，屬於官網前端用的介面，不算「開放」，不採用 |
| Foursquare OS Places | Apache-2.0，但現在要註冊取 token、Hugging Face 要審核，不如 Overture 直接 |
| Google Places 等 | 競賽規則禁止 |

## 怎麼更新

```bash
python3 -m venv /tmp/ovenv && /tmp/ovenv/bin/pip install duckdb
/tmp/ovenv/bin/python scripts/build_poi_index.py --release 2026-10-21.0   #
```

輸出 `web/public/lab/poi_index.json`（約 1.7 MB，gzip 後約 0.5 MB；第一次搜尋才下載）。

腳本做的事：

1. 取台灣範圍、`confidence ≥ 0.5`、未標記永久歇業的地點；地址國別必須是 TW（排除金門對岸）。
2. 只用**店名**對照品牌的正規式分類（brand 欄位常被錯掛，例如「阿官火鍋專家」掛成海底撈），並排除「全家福」「海底撈旗魚專賣店」這類同名不同店。
3. 同品牌近距離去重（便利商店 40 m、餐廳咖啡 100 m）；不同來源的同一家店座標常差幾十公尺，英文名與中文名各有一筆。
4. 重複時優先保留中文店名與中文地址。

## 已收錄的品牌（34 個）

- 便利商店與超市：7-ELEVEN、全家、萊爾富、OK、全聯、美廉社、康是美、屈臣氏
- 速食與餐廳：麥當勞、肯德基、漢堡王、摩斯漢堡、Subway、達美樂、必勝客、吉野家、食其家、壽司郎、爭鮮、海底撈、鼎泰豐、八方雲集、麥味登、丹丹漢堡、頂呱呱、拿坡里、鬍鬚張
- 咖啡飲料：星巴克、路易莎、cama café、85度C、Comebuy、50嵐、可不可

要加品牌：在 `scripts/build_poi_index.py` 的 `BRANDS` 加一筆（`match` 是店名正規式、`aliases` 是搜尋用別名），重跑腳本。

## 資料品質（誠實揭露）

- 2026-10-21 版共 22,194 筆。和公司公布的店數比，7-ELEVEN、全家、麥當勞約多 10–20%（歇業未下架、不同來源重複、座標位置不同）；**不是官方店鋪清單**。
- 有些地址是英文（來源資料本來就是英文）。
- 頁面底部有標示資料版本與可能歇業；導航只用座標，所以差幾十公尺不會讓人走錯方向，但到了門口附近要看實際招牌。
