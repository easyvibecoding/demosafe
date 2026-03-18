# Chrome Extension Architecture

> Status: ✅ Core features completed (WebSocket connection, NMH dual-path IPC, Content Script masking, Popup UI, Smart Key Extraction confirmation dialog)

---

## System Architecture

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

## Component Description

### Background Service Worker (`service-worker.ts`)

**Responsibilities**:
- Maintain WebSocket connection to Swift Core (with exponential backoff reconnection)
- Obtain IPC connection info via Native Messaging Host
- **Dual-path dispatch**: WS primary → NMH fallback (get_state / submit_captured_key / toggle_demo_mode)
- Receive Core events and forward to Content Scripts
- Respond to Popup state queries
- Persist pattern cache to `chrome.storage.local`

**Connection Flow**:
1. Call Native Messaging Host to obtain `{port, token}`
2. Establish WebSocket to `ws://127.0.0.1:{port}`
3. Send handshake (clientType: 'chrome', token, version)
4. Receive success → mark as connected, start receiving events

**Dual-path Dispatch**:
- `sendRequest(action, payload)` — unified entry point
- WS connected → send via WS (with request-response correlation + 5s timeout)
- WS disconnected + action in relay list → fallback via NMH
- Both fail → log warning (plaintext keys are NOT queued to chrome.storage — security red line)

**Dev Fallback**:
- When Native Host is unavailable, read manually configured port/token from `chrome.storage.local`
- Options page provides Dev IPC Config input interface

### Content Script (`masker.ts`)

**Responsibilities**:
- Inject into known API console pages
- Scan DOM text nodes using TreeWalker
- Apply CSS overlay masking to text matching patterns
- MutationObserver monitors dynamic content changes (SPA pages)
- Restore original text when exiting Demo Mode

**Masking Method**:
```html
<!-- Original -->
<div>sk-proj-abcdef1234567890</div>

<!-- Masked -->
<div>
  <span class="demosafe-mask"
        data-demosafe-masked="KEY-UUID"
        title="[Demo-safe] OpenAI">
    sk-****...****
  </span>
</div>
```

**CSS Styles**:
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

**Initial State Sync**:
Content script proactively requests current state from background on load:
```typescript
chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
    isDemoMode = response.isDemoMode;
    if (isDemoMode) scanAndMask();
});
```

### Popup (`popup.ts` + `popup.html`)

**Displayed Information**:
- Connection status and path (green dot WebSocket / blue dot NMH / red dot Offline)
- Mode (Normal / Demo)
- Active Context name
- Pattern count
- Toggle Demo Mode button
- Capture Mode control

### Options (`options.ts` + `options.html`)

**Features**:
- Pattern cache count and timestamp
- Clear pattern cache
- Dev IPC Config (manual port + token input)
- Security information display

---

## Native Messaging Host

### Architecture (Dual-path IPC)

NMH supports two modes: **config query** and **WS relay**.

```
Chrome Extension → chrome.runtime.sendNativeMessage('com.demosafe.nmh', ...)
    ↓ stdin (4-byte length prefix + JSON)
NativeMessagingHost (Swift binary)
    ├─ action: get_config → read ~/.demosafe/ipc.json → return {port, token}
    └─ action: get_state / submit_captured_key / toggle_demo_mode
         → read ipc.json for port/token
         → open short-lived WS to Core (URLSessionWebSocketTask)
         → handshake (clientType: "nmh") → send request → receive response → close
         → stdout returns Core's response
    ↓ stdout (4-byte length prefix + JSON)
Chrome Extension ← response
```

**WS Relay Characteristics**:
- Short-lived connection: connect → handshake → 1 request → 1 response → close (~20-60ms)
- clientType `"nmh"`: Core skips NMH connections when broadcasting events
- 5 second timeout, failure returns `{"error": "core_unreachable" | "auth_failed" | "timeout"}`
- Automatically skips event messages pushed by Core after handshake (e.g., pattern_cache_sync)

### Supported Actions

| Action | Mode | Description |
|--------|------|-------------|
| `get_config` | Direct ipc.json read | Returns `{port, token}`, original behavior |
| `get_state` | WS relay | Returns isDemoMode, activeContext, patternCacheVersion |
| `submit_captured_key` | WS relay | Submit captured API key |
| `toggle_demo_mode` | WS relay | Toggle Demo Mode |

### Installation Paths

| File | Path |
|------|------|
| Swift binary | `~/.demosafe/bin/demosafe-nmh` |
| Host manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json` |

### Auto-installation (NMHInstaller)

Core automatically checks and installs NMH on startup:
1. Check if `~/.demosafe/bin/demosafe-nmh` exists (compare binary size)
2. Check if Chrome NMH manifest exists with correct allowed_origins
3. Missing or version mismatch → copy binary from app bundle Resources + write manifest
4. `install.sh` retained as manual fallback

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

## Content Script Target Websites

| Website | URL Pattern |
|---------|-------------|
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

## Message Flow

### Background ↔ Popup

| Direction | type | Description |
|-----------|------|-------------|
| Popup → BG | `get_state` | Request current state |
| Popup → BG | `toggle_demo_mode` | Toggle Demo Mode |
| BG → Popup | `state_update` | State change notification |

### Background ↔ Content Script

| Direction | action | Description |
|-----------|--------|-------------|
| BG → CS | `state_changed` | Demo Mode or Context change |
| BG → CS | `pattern_cache_sync` | Pattern sync |
| BG → CS | `key_updated` | Single key incremental update |
| BG → CS | `clipboard_cleared` | Clipboard cleared notification |

### Background ↔ Core (WebSocket)

Uses the standard IPC Protocol (see [protocol-spec.md](../05-ipc-protocol/protocol-spec.md)).
