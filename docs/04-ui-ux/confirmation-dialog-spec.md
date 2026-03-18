# Smart Key Extraction 確認對話框規格

> 最後更新：2026-03-18

## 概述

Smart Key Extraction 確認對話框為 Chrome Extension 的 content script 內嵌 UI，用於處理中信心度 API key 的確認流程。當偵測到的 key 信心度介於 0.35~0.7 之間時，系統先遮蔽該 key，再顯示確認對話框讓使用者決定是否儲存。

---

## 三區間信心度策略

| 信心度範圍 | 動作 | 說明 |
|-----------|------|------|
| >= 0.7（高） | 自動儲存 | 直接送 `submit_captured_key` 至 Core，顯示 toast |
| 0.35 ~ 0.7（中） | 遮蔽 + 確認對話框 | 先遮蔽明文，彈出 inline 對話框讓使用者確認 |
| < 0.35（低） | 忽略 | 不處理，不遮蔽 |

---

## 確認對話框 UI 設計

```
+--------------------------------------------------+
|  DemoSafe: Detected possible API key              |
|                                                    |
|  Service name: [__openai______________]  (editable)|
|  Key preview:  sk-proj-...xxxx                     |
|                                                    |
|  [ Confirm & Store ]     [ Reject ]       (27s)    |
+--------------------------------------------------+
```

### UI 元素

| 元素 | 說明 |
|------|------|
| 標題 | "DemoSafe: Detected possible API key" |
| Service name | 可編輯文字輸入框，預設為偵測到的 platform 名稱 |
| Key preview | 遮蔽後的 key 預覽（前綴 + ...末四碼） |
| Confirm & Store | 確認按鈕，提交至 Core 儲存 |
| Reject | 拒絕按鈕，恢復原文並加入 rejectedKeys |
| 倒數計時 | 右下角顯示剩餘秒數，30s 自動 dismiss |

### 行為表

| 操作 | 行為 |
|------|------|
| Confirm | 送 `submit_captured_key` 至 background → Core，關閉對話框，key 保持遮蔽 |
| Reject | 恢復該 key 的原始文字，加入 `rejectedKeys` Set，關閉對話框 |
| Escape | 等同 Reject |
| 30s 超時 | 自動 dismiss，key 保持遮蔽狀態（不提交也不恢復） |

---

## 佇列機制

當頁面同時偵測到多個中信心度 key 時，對話框以佇列方式依序顯示：

1. 第一個 key 的對話框立即顯示
2. 後續 key 加入 `pendingConfirmations` 佇列
3. 前一個對話框關閉後，自動彈出下一個
4. 每個對話框各自有獨立的 30s 倒數

---

## 去重機制

三組 Set 防止重複處理：

| Set | 作用 | 生命週期 |
|-----|------|---------|
| `submittedKeys` | 已提交至 Core 的 key（高信心度自動 + 確認） | 頁面生命週期 |
| `rejectedKeys` | 使用者拒絕的 key | 頁面生命週期 |
| `isAlreadyStoredKey()` | 查詢 Core 已知 key（透過 pattern 匹配） | 即時查詢 |

流程：偵測到 key → 檢查是否在 submittedKeys / rejectedKeys / isAlreadyStoredKey → 若已存在則跳過 → 否則依信心度分流。

---

## Universal Masking / Detection 開關

### Popup UI

兩個獨立 toggle 開關位於 popup 面板：

- **Universal Masking**：在非已知平台頁面也進行 DOM 遮蔽（預設 OFF）
- **Universal Detection**：在非已知平台頁面也進行 key 偵測（預設 OFF）

### 預設行為

- 已知平台（capture-patterns.ts 定義的 11+ 平台）：Demo Mode 開啟時自動啟用 masking 和 detection，不受 toggle 影響
- 非已知平台：僅在 toggle 開啟時啟用對應功能

### 決策函式

| 函式 | 邏輯 |
|------|------|
| `shouldMask(url)` | `isSupportedPlatform(url) \|\| universalMaskingEnabled` |
| `shouldAutoCapture(url)` | `isSupportedPlatform(url) \|\| universalDetectionEnabled` |

### 儲存

使用 `chrome.storage.local` 儲存，key 為 `universalMasking` 和 `universalDetection`。

---

## Generic Key Pattern

| 屬性 | 值 |
|------|---|
| pattern ID | `generic-key` |
| confidence | 0.50 |
| prefix | `""` (空字串) |
| 匹配規則 | 常見 prefix（key-, token-, api-, secret-, sk-, pk-, rk-）+ 30+ 字元英數 |
| 特殊處理 | `KEY_PREFIXES` 過濾空字串 prefix，避免 `containsFullKey()` 誤判 |

此 pattern 用於捕獲非已知平台的 API key，搭配 Universal Detection 使用。因 confidence 為 0.50（中區間），會觸發確認對話框。

---

## IPC 流程圖（中信心度 key）

```
Content Script                 Background SW              Core Engine
     |                              |                         |
     |  偵測到 key (0.35~0.7)       |                         |
     |  遮蔽明文                    |                         |
     |  顯示確認對話框               |                         |
     |                              |                         |
     |  [使用者按 Confirm]           |                         |
     |                              |                         |
     |-- submit_captured_key ------->|                         |
     |   {key, serviceName}         |                         |
     |                              |-- submit_captured_key -->|
     |                              |   {key, serviceName}    |
     |                              |                         |
     |                              |<-- key_stored ----------|
     |                              |   {keyId, masked}       |
     |<-- key_stored ---------------|                         |
     |                              |                         |
     |  顯示 toast                   |                         |
```

---

## 新增 Message Types

| Type | 方向 | Payload | 說明 |
|------|------|---------|------|
| `submit_captured_key` | Content → BG → Core | `{ key: string, serviceName: string, platform: string }` | 提交捕獲的 key |
| `key_stored` | Core → BG → Content | `{ keyId: string, masked: string }` | key 已儲存確認 |
| `get_universal_settings` | Popup → BG | `{}` | 取得 universal toggle 狀態 |
| `set_universal_settings` | Popup → BG | `{ masking: boolean, detection: boolean }` | 設定 universal toggle |
| `universal_settings_changed` | BG → Content | `{ masking: boolean, detection: boolean }` | 廣播 toggle 狀態變更 |

---

## 檔案變更表

| 檔案 | 變更 |
|------|------|
| `packages/chrome-extension/src/content/masker.ts` | 三區間信心度判斷、確認對話框 UI、佇列機制、rejectedKeys |
| `packages/chrome-extension/src/content/confirmation-dialog.ts` | 對話框元件：建立、事件、倒數、Escape |
| `packages/chrome-extension/src/content/capture-patterns.ts` | 新增 `generic-key` pattern |
| `packages/chrome-extension/src/background/service-worker.ts` | universal settings 儲存/廣播 |
| `packages/chrome-extension/src/popup/popup.ts` | Universal Masking / Detection toggle UI |
| `packages/chrome-extension/src/popup/popup.html` | toggle HTML 結構 |
| `packages/chrome-extension/src/content/pre-hide.ts` | `turbo:before-render` 監聽 |
| `packages/chrome-extension/src/content/toast.ts` | 持續時間改為 25s |
