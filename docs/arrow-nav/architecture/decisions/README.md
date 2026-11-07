# 架構決策紀錄

格式是 MADR。新增決策時，編號接下去，並更新這張表和 [arc42 §9](../arc42.md#9-架構決策)。

| ADR | 決策 | 狀態 |
|---|---|---|
| [0001](0001-keep-the-app-thin.md) | App 保持很薄，功能放網頁 | accepted |
| [0002](0002-use-valhalla-for-walking-routes.md) | 用 Valhalla 算步行路線，OSRM 備案 | proposed（等 V3） |
| [0003](0003-use-web-sensors-first.md) | 感測先用網頁能力，備案是 Flutter 跨平台 Handler | accepted（V1、V2 決定是否啟用備案） |
| [0004](0004-serve-open-data-from-snapshots.md) | 開放資料用快照提供 | accepted |
| [0005](0005-keep-location-out-of-urls-and-logs.md) | 位置不進網址和 log | accepted |
| [0006](0006-recommend-routes-with-measured-reasons.md) | 用規則表推薦路線，原因必須量得到 | accepted |
| [0007](0007-keep-navigation-engine-in-web.md) | 導航引擎放在網頁 | accepted |
