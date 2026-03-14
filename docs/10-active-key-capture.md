# 主動式 API Key 網頁截取

> 狀態：❌ 未來開發
> 優先順序：中高（Phase 2 核心功能）

---

## 概述

目前使用者必須手動複製 API Key 再到 Demo-safe 新增。主動截取模式讓使用者在 Menu Bar 或 Chrome Extension 開啟「截取模式」後，自動偵測並擷取網頁上出現的 API Key，無需手動複製。

---

## 使用流程

```
1. 使用者在 Menu Bar 或 Chrome Extension popup 啟用「Key Capture」模式
2. 使用者前往 API 管理頁面（如 platform.openai.com → API Keys → Create）
3. 網頁產生 Key 的瞬間，Chrome Extension 自動偵測並擷取
4. Demo-safe 彈出確認通知：「偵測到 OpenAI API Key，是否加入保庫？」
5. 使用者確認 → Key 直接儲存到 Keychain，從未在螢幕上停留
6. 截取模式自動關閉（或手動關閉）
```

---

## 兩種觸發方式

### Menu Bar 觸發

```
Menu Bar → Quick Actions → 「Start Key Capture」
    ↓
IPCServer broadcast → Chrome Extension 啟用截取模式
    ↓
Content Script 開始主動掃描
    ↓
偵測到 Key → submit_detected → Core 顯示確認
```

### Chrome Extension Popup 觸發

```
Popup → 「Start Capture」按鈕
    ↓
Background → 通知所有 Content Scripts 啟用截取模式
    ↓
Content Script 開始主動掃描
    ↓
偵測到 Key → Background → WebSocket → Core 顯示確認
```

---

## Content Script 截取策略

### 被動模式（現有）vs 主動模式（新增）

| 維度 | 被動模式（現有） | 主動截取模式（新增） |
|------|----------------|-------------------|
| 觸發 | 永遠運作 | 使用者明確啟用 |
| 行為 | 遮蔽已知 pattern | 偵測新 Key 並提交 |
| 對象 | 頁面中的文字節點 | 文字節點 + input + clipboard + 動態元素 |
| 結果 | 視覺遮蔽 | 擷取 Key 值到 Core |

### 主動模式掃描目標

1. **DOM 文字節點**：TreeWalker 掃描 `<code>`、`<pre>`、`<span>` 中的 Key 格式文字
2. **Input / Textarea**：API 管理頁面產生 Key 後常顯示在 input 欄位中
3. **動態內容**：MutationObserver 監聽 DOM 變更，新出現的 Key 立即偵測
4. **剪貼簿監聽**：使用者在頁面上按複製時，攔截剪貼簿內容比對 pattern
5. **Modal / Dialog**：許多平台在 modal 中一次性顯示 Key（如 OpenAI 的 "Copy" 按鈕旁）

### 各平台 Key 產生頁面特徵

| 平台 | Key 出現位置 | 特殊行為 |
|------|-------------|---------|
| OpenAI | Modal dialog，含 Copy 按鈕 | Key 只顯示一次，關閉後不可再查看 |
| Anthropic | 頁面內 `<code>` 元素 | 同上，一次性顯示 |
| AWS IAM | CSV 下載或頁面顯示 | Access Key + Secret Key 同時出現 |
| Stripe | Dashboard 頁面內嵌顯示 | Restricted Key 可反覆查看 |
| GitHub | Token 產生後頁面顯示 | 只顯示一次 |
| Google Cloud | JSON 檔案下載 | 非頁面顯示，需攔截下載 |

---

## IPC 擴展

### 新增 IPC Actions

**Extension → Core**：

```json
{
  "type": "request",
  "action": "submit_captured_key",
  "payload": {
    "rawValue": "sk-proj-abc123...",
    "suggestedService": "OpenAI",
    "sourceURL": "https://platform.openai.com/api-keys",
    "confidence": 0.95,
    "captureMethod": "dom_scan"
  }
}
```

**Core → Extension**：

```json
{
  "type": "event",
  "action": "capture_mode_changed",
  "payload": {
    "isActive": true,
    "timeout": 300
  }
}
```

### 新增 State 欄位

```typescript
interface DemoSafeState {
    // 既有
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
    // 新增
    isCaptureMode: boolean;
    captureTimeout: number | null;  // 秒，null = 無限
}
```

---

## 安全考量

| 風險 | 對策 |
|------|------|
| 截取到非 Key 的文字 | 信心分數 < 0.7 時不自動提交，需使用者確認 |
| 截取模式長時間開啟 | 設定超時（預設 5 分鐘），超時自動關閉 |
| 頁面注入假 Key 釣魚 | 比對 URL domain 白名單，非預期 domain 降低信心分數 |
| Key 在記憶體中停留 | 提交後立即歸零清除 Content Script 中的暫存值 |
| 截取時 Key 仍可見 | 截取成功後立即觸發 DOM 遮蔽（被動模式接管） |

---

## 與現有功能的整合

### 截取 → 遮蔽 無縫銜接

```
主動截取偵測到 Key
    ↓
submit_captured_key → Core
    ↓
Core 儲存至 Keychain + Vault
    ↓
觸發 pattern_cache_sync → 所有 Extension
    ↓
Content Script 被動模式立即遮蔽該 Key
    ↓
Key 在頁面上被遮蔽，使用者從頭到尾沒看到明文
```

### 與 Linked Groups 整合

AWS 等平台同時產生多個相關 Key（Access Key ID + Secret Key）：

```
截取到 AKIA... (Access Key ID)
截取到 wJal... (Secret Key)
    ↓
Core 偵測到同時來自 console.aws.amazon.com
    ↓
自動提議建立 LinkedGroup
    ↓
確認對話框：
  ✓ AWS Access Key ID   AKIA****
  ✓ AWS Secret Key      ****       ↔ 與上方建立關聯？
  [ 全部加入 ]  [ 逐一確認 ]  [ 取消 ]
```

---

## UI 變更

### Menu Bar

```
Quick Actions:
  ├── 🔍 Start Key Capture        ← 新增（啟用截取模式）
  ├── Context Mode Switcher
  └── Settings...
```

啟用後顯示：
```
  ├── 🔴 Stop Key Capture (4:32)  ← 倒計時
```

### Chrome Extension Popup

```
┌─────────────────────┐
│ 🛡️ DemoSafe         │
│                      │
│ Connection  ● Connected │
│ Mode        Demo     │
│ Capture     ● Active │  ← 新增狀態列
│                      │
│ [Stop Capture (4:32)]│  ← 啟用時顯示
│ [Enter Demo Mode]    │
└─────────────────────┘
```

### 系統通知

截取成功時透過 macOS 通知：
```
🔑 Demo-safe: Key Captured
OpenAI API Key 已加入保庫
sk-proj-****...****
```
