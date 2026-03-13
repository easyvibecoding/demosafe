# Chrome Extension 架構

> 狀態：✅ 核心功能完成（WebSocket 連線、Content Script masking、Popup UI）
> 尚未完成：Native Messaging Host 部署、Smart Extract

---

## 系統架構

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                    │
│                                                       │
│  ┌──────────────┐  ┌───────────┐  ┌───────────────┐ │
│  │ Background   │  │  Popup    │  │ Content Script│ │
│  │ Service      │←→│  (UI)     │  │ (per tab)     │ │
│  │ Worker       │  └───────────┘  └───────┬───────┘ │
│  │              │←─────────────────────────┘         │
│  └──────┬───────┘                                     │
│         │ WebSocket                                   │
└─────────┼─────────────────────────────────────────────┘
          │
          ↓
┌──────────────────┐     ┌──────────────────────┐
│ Native Messaging │────→│ ~/.demosafe/ipc.json │
│ Host (Swift)     │     └──────────────────────┘
└──────────────────┘
          │ port + token
          ↓
┌──────────────────┐
│ Swift Core       │
│ IPCServer        │
│ (WebSocket)      │
└──────────────────┘
```

---

## 元件說明

### Background Service Worker (`service-worker.ts`)

**職責**：
- 維持與 Swift Core 的 WebSocket 連線（含指數退避重連）
- 透過 Native Messaging Host 取得 IPC 連線資訊
- 接收 Core 事件並轉發至 Content Scripts
- 回應 Popup 的狀態查詢
- 持久化 pattern cache 至 `chrome.storage.local`

**連線流程**：
1. 呼叫 Native Messaging Host 取得 `{port, token}`
2. 建立 WebSocket 至 `ws://127.0.0.1:{port}`
3. 發送 handshake（clientType: 'chrome', token, version）
4. 收到 success → 標記 connected，開始接收事件

**Dev Fallback**：
- Native Host 不可用時，從 `chrome.storage.local` 讀取手動設定的 port/token
- Options 頁面提供 Dev IPC Config 輸入介面

### Content Script (`masker.ts`)

**職責**：
- 注入至已知 API console 頁面
- 使用 TreeWalker 掃描 DOM 文字節點
- 對匹配 pattern 的文字套用 CSS overlay 遮蔽
- MutationObserver 監聽動態內容變更（SPA 頁面）
- 退出 Demo Mode 時恢復原始文字

**遮蔽方式**：
```html
<!-- 原始 -->
<div>sk-proj-abcdef1234567890</div>

<!-- 遮蔽後 -->
<div>
  <span class="demosafe-mask"
        data-demosafe-masked="KEY-UUID"
        title="[Demo-safe] OpenAI">
    sk-****...****
  </span>
</div>
```

**CSS 樣式**：
```css
.demosafe-mask {
    background-color: #1a1a2e;
    color: #e94560;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    user-select: none;
}
.demosafe-mask:hover::after {
    content: ' 🔒';
}
```

**初始狀態同步**：
Content script 載入時主動向 background 請求當前狀態：
```typescript
chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
    isDemoMode = response.isDemoMode;
    if (isDemoMode) scanAndMask();
});
```

### Popup (`popup.ts` + `popup.html`)

**顯示資訊**：
- Connection 狀態（綠點 Connected / 紅點 Offline）
- Mode（Normal / Demo）
- Active Context 名稱
- Pattern 數量
- Toggle Demo Mode 按鈕

### Options (`options.ts` + `options.html`)

**功能**：
- Pattern cache 數量和時間戳
- 清除 pattern cache
- Dev IPC Config（手動輸入 port + token）
- 安全資訊顯示

---

## Native Messaging Host

### 架構

```
Chrome Extension → chrome.runtime.sendNativeMessage('com.demosafe.nmh', ...)
    ↓ stdin (4-byte length prefix + JSON)
NativeMessagingHost (Swift binary)
    ↓ 讀取 ~/.demosafe/ipc.json
    ↓ stdout (4-byte length prefix + JSON)
Chrome Extension ← { port: 55535, token: "..." }
```

### 安裝路徑

| 檔案 | 路徑 |
|------|------|
| Swift binary | `/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh` |
| Host manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json` |

### Host Manifest (`com.demosafe.nmh.json`)

```json
{
    "name": "com.demosafe.nmh",
    "description": "DemoSafe Native Messaging Host",
    "path": "/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://ACTUAL_EXTENSION_ID/"
    ]
}
```

### 部署步驟（尚未自動化）

1. 編譯 `native-host/NativeMessagingHost.swift` 為 binary
2. 放置至 `/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh`
3. 將 `com.demosafe.nmh.json` 複製至 NativeMessagingHosts 目錄
4. 替換 `EXTENSION_ID_HERE` 為實際 Chrome Extension ID

---

## Content Script 目標網站

| 網站 | URL Pattern |
|------|-------------|
| OpenAI | `https://platform.openai.com/*` |
| Anthropic | `https://console.anthropic.com/*` |
| AWS | `https://console.aws.amazon.com/*` |
| Stripe | `https://dashboard.stripe.com/*` |
| Google Cloud | `https://console.cloud.google.com/*` |
| Azure | `https://portal.azure.com/*` |
| GitHub Tokens | `https://github.com/settings/tokens*` |
| Hugging Face | `https://huggingface.co/settings/tokens*` |
| SendGrid | `https://app.sendgrid.com/*` |
| Slack API | `https://api.slack.com/*` |

---

## 訊息流

### Background ↔ Popup

| 方向 | type | 說明 |
|------|------|------|
| Popup → BG | `get_state` | 請求當前狀態 |
| Popup → BG | `toggle_demo_mode` | 切換 Demo Mode |
| BG → Popup | `state_update` | 狀態變更通知 |

### Background ↔ Content Script

| 方向 | action | 說明 |
|------|--------|------|
| BG → CS | `state_changed` | Demo Mode 或 Context 變更 |
| BG → CS | `pattern_cache_sync` | Pattern 同步 |
| BG → CS | `key_updated` | 單一 Key 增量更新 |
| BG → CS | `clipboard_cleared` | 剪貼簿已清除通知 |

### Background ↔ Core (WebSocket)

使用標準 IPC Protocol（見 [protocol-spec.md](../05-ipc-protocol/protocol-spec.md)）。
