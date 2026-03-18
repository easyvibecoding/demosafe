# Chrome Extension 架構

> 狀態：✅ 核心功能完成（WebSocket 連線、NMH 雙路 IPC、Content Script masking、Popup UI、Smart Key Extraction 確認對話框）

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
- **雙路分派**：WS primary → NMH fallback（get_state / submit_captured_key / toggle_demo_mode）
- 接收 Core 事件並轉發至 Content Scripts
- 回應 Popup 的狀態查詢
- 持久化 pattern cache 至 `chrome.storage.local`

**連線流程**：
1. 呼叫 Native Messaging Host 取得 `{port, token}`
2. 建立 WebSocket 至 `ws://127.0.0.1:{port}`
3. 發送 handshake（clientType: 'chrome', token, version）
4. 收到 success → 標記 connected，開始接收事件

**雙路分派（Dual-path Dispatch）**：
- `sendRequest(action, payload)` 統一入口
- WS 連線中 → 透過 WS 發送（含 request-response correlation + 5s timeout）
- WS 斷線且 action 為 relay 清單 → 透過 NMH fallback
- 雙路皆失敗 → log warning（不將明文 key 存入 chrome.storage，遵守安全紅線）

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
- Connection 狀態與路徑（綠點 WebSocket / 藍點 NMH / 紅點 Offline）
- Mode（Normal / Demo）
- Active Context 名稱
- Pattern 數量
- Toggle Demo Mode 按鈕
- Capture Mode 控制

### Options (`options.ts` + `options.html`)

**功能**：
- Pattern cache 數量和時間戳
- 清除 pattern cache
- Dev IPC Config（手動輸入 port + token）
- 安全資訊顯示

---

## Native Messaging Host

### 架構（雙路 IPC）

NMH 同時支援兩種模式：**config 查詢**和 **WS relay**。

```
Chrome Extension → chrome.runtime.sendNativeMessage('com.demosafe.nmh', ...)
    ↓ stdin (4-byte length prefix + JSON)
NativeMessagingHost (Swift binary)
    ├─ action: get_config → 讀取 ~/.demosafe/ipc.json → 回傳 {port, token}
    └─ action: get_state / submit_captured_key / toggle_demo_mode
         → 讀取 ipc.json 取得 port/token
         → 建立短暫 WS 連線至 Core（URLSessionWebSocketTask）
         → handshake (clientType: "nmh") → 送 request → 收 response → 斷線
         → stdout 回傳 Core 的 response
    ↓ stdout (4-byte length prefix + JSON)
Chrome Extension ← response
```

**WS Relay 特性**：
- 短暫連線：connect → handshake → 1 request → 1 response → close（~20-60ms）
- clientType `"nmh"`：Core 不會對 NMH 連線推送 events（broadcast 時跳過）
- 5 秒 timeout，失敗回傳 `{"error": "core_unreachable" | "auth_failed" | "timeout"}`
- 會自動跳過 handshake 後 Core 推送的 event messages（如 pattern_cache_sync）

### 支援的 Actions

| Action | 模式 | 說明 |
|--------|------|------|
| `get_config` | 直讀 ipc.json | 回傳 `{port, token}`，原有行為 |
| `get_state` | WS relay | 回傳 isDemoMode、activeContext、patternCacheVersion |
| `submit_captured_key` | WS relay | 提交截取到的 API key |
| `toggle_demo_mode` | WS relay | 切換 Demo Mode |

### 安裝路徑

| 檔案 | 路徑 |
|------|------|
| Swift binary | `~/.demosafe/bin/demosafe-nmh` |
| Host manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json` |

### 自動安裝（NMHInstaller）

Core 啟動時自動檢查並安裝 NMH：
1. 檢查 `~/.demosafe/bin/demosafe-nmh` 是否存在（比對 binary size）
2. 檢查 Chrome NMH manifest 是否存在且 allowed_origins 正確
3. 缺少或版本不符 → 從 app bundle Resources 複製 binary + 寫入 manifest
4. `install.sh` 保留作為手動備援

### Host Manifest (`com.demosafe.nmh.json`)

```json
{
    "name": "com.demosafe.nmh",
    "description": "DemoSafe Native Messaging Host — relay for Chrome Extension",
    "path": "/Users/<user>/.demosafe/bin/demosafe-nmh",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://ACTUAL_EXTENSION_ID/"
    ]
}
```

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
