# 06 · 裝置端 AI（若作品有 AI 功能）

> 主持人建議：**沒有 AI 也能做出好作品**。先釐清 AI 為使用者解決什麼問題再加。

## 規則重點
- 執行時 LLM 推論 **100% 在手機上**；不得呼叫雲端 LLM API。評審可能**關網路**測。
- 一般後端、預先生成的內容可以（需如實說明）。
- README 揭露：模型名稱、版本、量化格式、推論框架、來源。禁用資安黑名單/大陸廠牌模型。

## 建議架構
```
微服務網頁 ── postMessage({name:'llm_ask', data:'附近哺乳室？'}) ──▶ App: LlmMessageHandler（自訂）
                                                                     └▶ 裝置端推論引擎（flutter_edge_ai / llamadart）
          ◀── {name:'llm_ask', data:'最近的在…'} ──────────────────────┘
```
- 模型由 App **載入一次**，多個微服務共用。
- 把開放資料塞進 prompt（**RAG**）提升小模型品質；資料可由網頁一起傳給 Handler。
- 整條流程離線可運作。

## 套件與模型
| Flutter 套件 | 支援 | 特色 | 授權 |
|---|---|---|---|
| **flutter_edge_ai**（原 flutter_gemma）2.3.2 | Gemma 4 E2B/E4B、Gemma 3n、Phi-4 Mini；`.litertlm` `.task` `.onnx` | LiteRT-LM，Android GPU/NPU 加速，多模態、function calling | MIT |
| **llamadart** 0.8.19 | GGUF（llama.cpp）、`.litertlm`；Dart 3.10+ / Flutter 3.38+ | 一套 API 跨 iOS/Android/桌面；Metal/Vulkan | MIT |

- 推薦模型：**Gemma 4 E2B**（2026/4/2 發布，Apache 2.0，行動裝置設計；8GB RAM 手機較穩）
- 繁中表現差異大，**用實際題目測**；量化格式影響速度與品質。
- 模型數 GB → App 首次啟動下載，或 Demo 前預先放進實機。

## 選模型時避開（補充）
- 「危害國家資通安全產品（含大陸廠牌）」→ **不要用** Qwen（通義千問）、DeepSeek、GLM／ChatGLM、Yi、MiniCPM、Baichuan、InternLM 等，以及以它們為底的微調／蒸餾版（例如 DeepSeek-R1-Distill-*）。
- 安全選擇：Gemma 4（Google，Apache 2.0）、Phi-4 Mini（Microsoft，MIT）、Llama 系列（Meta，注意其授權有額外條款，README 要寫清楚）、TAIDE（國科會，繁中）。授權以模型頁為準。

## 實作補充
- `onReply` 可以呼叫多次 → 長回答可分段回傳（網頁端同一個 name 持續接收，最後送一個結束標記）。
- 模擬器跑不動 → 一定要 **Android 實機（8 GB RAM 以上）**；模型檔數 GB，注意手機與筆電硬碟空間（筆電目前只剩 38 GB）。
- 模型檔不要進 git repo；README 寫下載網址與放置路徑。

## Demo 注意
- 首次載入需數十秒 → **Demo 前預熱**
- **飛航模式完整測試一次**
- 需實機（iOS 需 Mac 建置）；評審可能**關 Wi-Fi 與行動網路、現場出新題目**
- 長時間推論考慮 streaming 回覆（多次 onReply）或 loading UI
