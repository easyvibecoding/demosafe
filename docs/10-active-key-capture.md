# 主動式 API Key 網頁截取

> 狀態：✅ 已實作（Phase 5）
> 8 平台 E2E 測試通過：GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS
> 詳見 [支援平台清單](en/13-supported-platforms.md) 及 [平台截取策略](11-platform-specific-capture-strategies.md)

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

### 各平台 Key 產生頁面特徵（實地調查 2026-03）

#### Category A：一次性顯示（關閉後不可再查看）— 截取最關鍵

| 平台 | URL | 前綴 | 顯示方式 | Regex |
|------|-----|------|---------|-------|
| OpenAI | `platform.openai.com/api-keys` | `sk-proj-` | Modal dialog + Copy 按鈕 | `sk-proj-[A-Za-z0-9_-]{80,}` |
| Anthropic | `console.anthropic.com/settings/keys` | `sk-ant-api03-` | Pop-up dialog + Copy Key 按鈕 | `sk-ant-api03-[A-Za-z0-9_-]{80,}` |
| AWS IAM | `console.aws.amazon.com/iam/` | `AKIA` / 40字元 secret | 多步驟 wizard 最後一頁 + Download CSV | `AKIA[0-9A-Z]{16}` |
| GitHub | `github.com/settings/tokens` | `ghp_` / `github_pat_` | Inline 頁面 + 警告文字 | `ghp_[A-Za-z0-9]{36}` |
| SendGrid | `app.sendgrid.com/settings/api_keys` | `SG.` | 建立確認頁 | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` |
| Stripe (live) | `dashboard.stripe.com/apikeys` | `sk_live_` | 建立時一次顯示 | `sk_(test\|live)_[a-zA-Z0-9]{24,}` |

#### Category B：可重複查看 / Toggle 顯示

| 平台 | URL | 前綴 | 顯示方式 | Regex |
|------|-----|------|---------|-------|
| Google Cloud | `console.cloud.google.com/apis/credentials` | `AIzaSy` | 永遠可見 + 點擊查看 | `AIzaSy[A-Za-z0-9_-]{33}` |
| Hugging Face | `huggingface.co/settings/tokens` | `hf_` | Show/Hide toggle | `hf_[a-zA-Z0-9]{30,}` |
| Slack | `api.slack.com/apps/*/oauth` | `xoxb-` / `xoxp-` | 永遠可見在 OAuth 頁面 | `xox[bpae]-[0-9]+-[A-Za-z0-9-]+` |
| Stripe (test) | `dashboard.stripe.com/test/apikeys` | `sk_test_` | Reveal/Hide toggle | 同上 |
| Vercel | `vercel.com/*/settings/environment-variables` | 各種 | Eye icon toggle（Sensitive 永不可見） | 依內容比對 |

#### 各平台 DOM 元素結構（2026-03 實測）

| 平台 | Key 所在元素 | Copy 機制 | 穩定選擇器 | 框架 |
|------|------------|----------|-----------|------|
| OpenAI | `div.api-key-token-value` | Modal (Radix UI) | ✅ `api-key-token-value` | Radix + Emotion |
| Anthropic | `<code>` in table cell | Dialog 內 Copy 按鈕 | ⚠️ Tailwind `text-text-300` | React + Tailwind |
| GitHub | `<clipboard-copy value="token">` | Web Component `value` attr | ✅ `clipboard-copy[value]` | Server-rendered + Web Components |
| Google Cloud | `<services-show-api-key-string>` | Material 按鈕 (Show key) | ✅ 自訂元素名 | Angular + Material |
| Hugging Face | `<td>` 裸文字節點 | 不明 | ❌ 無 wrapper | Server-rendered + Tailwind |
| Stripe | 可能 `<input readonly>` | 相鄰按鈕 | ⚠️ CSS modules hash | React + CSS modules |
| AWS | Cloudscape `Input` + `CopyToClipboard` | Cloudscape 元件 | ⚠️ `awsui_*_hash` | React + Cloudscape |
| Slack | 不明 | 不明 | 不明 | 不明 |
| SendGrid | 不明（一次性顯示） | 不明 | 不明 | 不明 |

**重要發現**：
- **沒有平台使用 Shadow DOM** — content script 皆可存取
- **沒有平台的 CSP 阻擋 content script 注入**
- **動態 class name**：OpenAI（Emotion `css-*`）、GCP（Angular `_nghost-*`）、Stripe（CSS modules）的 hash class 每次 build 都會變

#### 截取策略對應

| 策略 | 適用場景 | 實作方式 | 優先順序 |
|------|---------|---------|---------|
| TreeWalker + Regex | 所有平台通用 | 掃描文字節點比對 prefix pattern | **主要策略** |
| MutationObserver | Category A 的 modal/dialog | 監聽 DOM 新增節點，觸發 TreeWalker | **必備** |
| 平台特定選擇器 | OpenAI、GitHub、GCP | 用穩定的語義 class/元素名加速偵測 | 輔助加速 |
| 剪貼簿監聽 | 使用者點 Copy 按鈕 | `navigator.clipboard` 攔截 | 補充偵測 |
| `clipboard-copy[value]` | GitHub 專用 | 讀取 Web Component 的 `value` attribute | 平台特定 |

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
