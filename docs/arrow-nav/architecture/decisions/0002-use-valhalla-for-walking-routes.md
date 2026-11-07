# 0002. 用 Valhalla 算步行路線，OSRM 備案

- Status: proposed
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: routing

## Context and Problem Statement

要依使用者和時間提供不同候選路線。路徑引擎要開源、可自架，而且能調整步行偏好。

## Decision Drivers

- 長者、晚上、兒童要用不同權重
- 比賽禁止 Google Maps、Mapbox
- 部署用免費方案，映像和記憶體不能太大
- 只有 1 人負責後端，時間短

## Considered Options

1. Valhalla（MIT）
2. OSRM（BSD-2），每種情境一套 profile
3. 自己用 pgRouting 或 NetworkX 寫

## Decision Outcome

Chosen option: "Valhalla"，因為同一份路網每次查詢都可調 `step_penalty`、`use_lit`、`use_hills` 等權重，不需要多份路網。**16:30 依 V3 的結果定案**，失敗就用 OSRM。

### Consequences

- Good: 新增候選只改規則表
- Good: 支援 `alternates`、`exclude_polygons`，之後可以繞開施工
- Bad: 映像可能超過 Artifact Registry 免費 0.5 GB，要實測
- Bad: 語言表沒有 `zh-TW`，所以不用它的文字指令，用自家語言檔
- Neutral: 所有格式只在 adapter 轉換，換引擎時前端不用改

## Pros and Cons of the Options

### OSRM

- Good: 快；映像小；隊伍較熟悉
- Bad: 權重要在建圖時決定，每種情境一份路網；座標順序是 `lon,lat`

### 自己寫

- Bad: 時間不夠，品質也沒有保證

## More Information

- [Valhalla Route API](https://valhalla.github.io/valhalla/api/route/api-reference/)
- [02 候選路線](../../02-route-candidates.md)
