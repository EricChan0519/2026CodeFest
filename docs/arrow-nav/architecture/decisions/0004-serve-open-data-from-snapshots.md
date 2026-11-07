# 0004. 開放資料用快照提供

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: data

## Context and Problem Statement

站位、路口、路燈來自外部。要在請求時即時取得，還是事先產生？

## Decision Drivers

- 現場網路不穩，Demo 不能中斷
- TDX 要金鑰且有呼叫限制
- 路燈檔有 51 MB，不能在請求時處理
- 站位、路燈都不會每分鐘變動

## Considered Options

1. 建置時產生快照，打包進 API 映像
2. 請求時即時呼叫，加快取
3. 放資料庫，定時更新

## Decision Outcome

Chosen option: "快照"，因為執行時不依賴外部服務，也不需要 TDX 金鑰和資料庫。

### Consequences

- Good: API 無狀態，部署簡單
- Good: 腳本就是資料更新流程，方便移交
- Bad: 無法提供即時資料，所以到站時間和今日施工留到之後
- Neutral: 回應和關於頁要標示資料時間

## Pros and Cons of the Options

### 即時呼叫

- Good: 資料最新
- Bad: 多一個失敗點；金鑰要進執行環境

### 資料庫

- Bad: 多一個要維運、要付費的元件，目前的查詢用不到
