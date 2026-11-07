# 0001. App 保持很薄，功能放網頁

- Status: accepted
- Date: 2026-11-07
- Deciders: 隊長、Claude
- Tags: app, webview

## Context and Problem Statement

服務跑在 TownPass 內。功能可以寫在 Flutter，也可以寫在 WebView 載入的網頁。要怎麼分？

## Decision Drivers

- 只有隊長有 Flutter 環境
- 網頁更新不需要重 build App
- 主辦要能整併，App 改動越少越好

## Considered Options

1. 薄 App：只加服務設定和少量 Handler，功能都在網頁
2. 用 Flutter 寫原生畫面
3. 網頁和 Flutter 各做一半

## Decision Outcome

Chosen option: "薄 App"，因為全組都能開發，更新也不用重裝 APK，整併時 App 只有少量改動。

### Consequences

- Good: 組員不用裝 Flutter、Java、Android Studio
- Good: 同一份網頁有機會在 Android、iOS 都能跑
- Bad: 受 WebView 能力限制，語音和震動要靠 Handler
- Neutral: Handler 只用 Flutter 跨平台套件，見 [ADR-0003](0003-use-web-sensors-first.md)

## Pros and Cons of the Options

### Flutter 原生畫面

- Good: 感測和動畫最直接
- Bad: 只有隊長能開發，每次改畫面都要重 build

### 各做一半

- Bad: 邊界不清楚，要同步兩邊的狀態
