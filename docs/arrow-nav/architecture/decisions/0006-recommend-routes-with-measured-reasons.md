# 0006. 用規則表推薦路線，原因必須量得到

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: routing, wording

## Context and Problem Statement

要依使用者和時間提供候選路線，例如長者走少階梯少坡，晚上走路燈較多的路。要怎麼決定推薦哪一條？可以對使用者說什麼？

## Decision Drivers

- 使用者是弱勢族群，不能給錯誤的安全承諾
- OSM 有 `sidewalk` 標籤的車道只有約 6%，資料不完整
- 路燈資料是位置，不是實際亮度
- 隊友會調整規則，也可能新增情境

## Considered Options

1. 情境規則表，加上量測比對；只說量得到的改善
2. 綜合風險分數，顯示「安全分數」
3. 裝置端 AI 判斷

## Decision Outcome

Chosen option: "情境規則表＋量測比對"，因為簡單、可解釋，也不會誇大。

- 規則放在 `api/app/route_rules.py`。
- 只有量得到改善才給原因代碼。
- 不能標「安全路線」「無障礙路線」，要寫「路燈較多」「少階梯、少坡」。
- 找不到更合適的路時，回 `no_better_route`，並誠實告訴使用者。

### Consequences

- Good: 可以直接回答評審「依據是什麼」
- Good: 分階段砍功能不影響主流程
- Bad: 有些地方會一直沒有差別
- Neutral: 新增情境只要改規則表和語言檔

## Pros and Cons of the Options

### 安全分數

- Good: 看起來很厲害
- Bad: 分數沒有依據，也可能讓人誤以為有安全保證

### 裝置端 AI

- Bad: 沒有比規則更好的資料可判斷，手機資源也有限
