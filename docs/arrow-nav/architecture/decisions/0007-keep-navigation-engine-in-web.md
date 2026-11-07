# 0007. 導航引擎放在網頁

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: navigation, reliability

## Context and Problem Statement

箭頭角度、路線投影、走偏、抵達判斷，要放在哪裡計算？

## Decision Drivers

- 評審可能關網路現場測
- 箭頭要跟著手機即時轉
- 感測器不好測試，要能用軌跡回放
- 前端組員不寫 Flutter

## Considered Options

1. 網頁端，純 TypeScript 模組，不依賴 Vue
2. Flutter 端
3. 後端，每次更新都呼叫 API

## Decision Outcome

Chosen option: "網頁端純函式"，因為取得路線後不需要網路，也能用 Vitest 回放。

### Consequences

- Good: 離線可用；更新不用重 build
- Good: 可以用 `ReplaySensorSource` 跑模擬行走
- Bad: 要處理 WebView 背景暫停和低階手機效能
- Neutral: 重新規劃時才呼叫 API

## Pros and Cons of the Options

### Flutter 端

- Good: 背景執行較穩定
- Bad: 只有隊長能改，也不好測

### 後端

- Bad: 斷網就不能用，延遲也會讓箭頭卡頓，位置還要一直傳出去
