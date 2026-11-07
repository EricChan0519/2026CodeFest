# 0005. 位置不進網址和 log

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: privacy, security

## Context and Problem Statement

查附近站牌和算路線都要傳使用者位置。長者和兒童的即時位置很敏感，要怎麼傳、怎麼保存？

## Decision Drivers

- Cloud Run 請求紀錄會保留網址
- 公開比賽，評審可能問個資
- 服務不需要帳號

## Considered Options

1. 座標放 POST body，應用程式不記錄，不留存
2. 座標放 GET query，靠縮短 log 保存期限
3. 登入後保存位置歷史

## Decision Outcome

Chosen option: "POST body、不記錄"，因為從源頭就不留下位置。

### Consequences

- Good: 請求紀錄不會有使用者位置
- Good: 回答個資問題時很簡單：沒有留存
- Bad: POST 不方便用 CDN 快取，但這些回應本來就不應快取
- Neutral: `search` 用 GET，因為只傳站名，不傳座標
- Neutral: 新增的 Handler 要檢查 `sourceOrigin`，避免其他網頁取得位置

## Pros and Cons of the Options

### GET query

- Good: 開發方便
- Bad: 會留在基礎設施的紀錄

### 位置歷史

- Bad: 增加個資責任，服務也用不到
