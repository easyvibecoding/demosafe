# Chrome Extension Architecture

> Status: ✅ Core features completed (WebSocket connection, Content Script masking, Popup UI)
> Not yet completed: Native Messaging Host deployment, Smart Extract

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
- Receive Core events and forward to Content Scripts
- Respond to Popup state queries
- Persist pattern cache to `chrome.storage.local`

**Connection Flow**:
1. Call Native Messaging Host to obtain `{port, token}`
2. Establish WebSocket to `ws://127.0.0.1:{port}`
3. Send handshake (clientType: 'chrome', token, version)
4. Receive success → mark as connected, start receiving events

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
- Connection status (green dot Connected / red dot Offline)
- Mode (Normal / Demo)
- Active Context name
- Pattern count
- Toggle Demo Mode button

### Options (`options.ts` + `options.html`)

**Features**:
- Pattern cache count and timestamp
- Clear pattern cache
- Dev IPC Config (manual port + token input)
- Security information display

---

## Native Messaging Host

### Architecture

```
Chrome Extension → chrome.runtime.sendNativeMessage('com.demosafe.nmh', ...)
    ↓ stdin (4-byte length prefix + JSON)
NativeMessagingHost (Swift binary)
    ↓ reads ~/.demosafe/ipc.json
    ↓ stdout (4-byte length prefix + JSON)
Chrome Extension ← { port: 55535, token: "..." }
```

### Installation Paths

| File | Path |
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

### Deployment Steps (not yet automated)

1. Compile `native-host/NativeMessagingHost.swift` to binary
2. Place at `/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh`
3. Copy `com.demosafe.nmh.json` to NativeMessagingHosts directory
4. Replace `EXTENSION_ID_HERE` with actual Chrome Extension ID

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
