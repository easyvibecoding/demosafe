# Extension Responsibility Boundaries

## VS Code Extension (MVP)

### Responsibilities

| Category | Description |
|----------|-------------|
| ✅ Do | Match opened documents using local pattern cache |
| ✅ Do | Render masking via VS Code Decoration API |
| ✅ Do | Display lock icon in gutter to mark protected regions |
| ✅ Do | Monitor file changes and rescan patterns |
| ✅ Do | Maintain pattern cache received from Core |
| ✅ Do | Report detected keys via `submit_detected` |
| ✅ Do | Display Demo Mode status in status bar |
| ❌ Don't | Store plaintext keys |
| ❌ Don't | Define or manage patterns |
| ❌ Don't | Write to clipboard |
| ❌ Don't | Manage key CRUD |
| ❌ Don't | Handle hotkey paste operations |

### Core Loop

```
File open/change → regex scan (using cached patterns)
    → isDemoMode? → apply or clear decorations → gutter icons
```

### Offline Degradation

| State | Behavior |
|-------|----------|
| Core offline, cache available | Continue masking with last cached patterns |
| Core offline, no cache | Cannot mask; status bar shows "⚠ Demo-safe (No Cache)" warning |
| Core back online | Auto-reconnect + version comparison → incremental or full sync |

- Status bar shows "⚠ Demo-safe (Offline)"
- Paste functionality unavailable; user notification displayed
- Cache persisted in VS Code `globalState`, preserved across Extension restarts

---

## Chrome Extension (Phase 2)

### Responsibilities

| Category | Description |
|----------|-------------|
| ✅ Do | Detect known API pages via URL matching and domain lists |
| ✅ Do | Apply DOM masking via content scripts (CSS overlay + text replacement) |
| ✅ Do | Extract keys from pages using content script injection |
| ✅ Do | Send detected keys to Core via `submit_detected` |
| ✅ Do | Maintain pattern cache synced with Core |
| ✅ Do | Monitor dynamic content using MutationObserver |
| ❌ Don't | Store plaintext keys |
| ❌ Don't | Store key data in Chrome storage |
| ❌ Don't | Handle paste operations directly |
| ❌ Don't | Manage key CRUD |

### Connection Architecture

- Background Service Worker maintains WebSocket connection to Core
- Native Messaging Host (Swift helper) reads `ipc.json` for discovery

### Native Messaging Host Specification

Chrome Extensions cannot directly read the file system (`~/.demosafe/ipc.json`), so a Native Messaging Host is needed as a bridge:

| Item | Description |
|------|-------------|
| Implementation language | Swift (macOS helper binary) |
| Installation location | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json` |
| Responsibility | Read `ipc.json` → return `{port, token}` to Background Service Worker |
| Communication protocol | Chrome Native Messaging (stdin/stdout JSON) |
| Trigger timing | Called once on Extension startup to get connection info; re-called after Core restart |
| Security | Manifest restricts `allowed_origins` to only this Extension ID |

---

## Accessibility Agent (Phase 3)

### Responsibilities

| Category | Description |
|----------|-------------|
| ✅ Do | Provide system-level text interception via AXUIElement API |
| ✅ Do | Apply all-application masking covering terminal and system tools |
| ✅ Do | Monitor multi-display setups and provide consistent overlay |
| ❌ Don't | Duplicate masking where VS Code/Chrome Extensions already cover |

### Coverage Coordination

Core maintains a coverage registry that informs the Accessibility Agent which windows are already covered by connected Extensions, preventing duplicate masking.

---

## Responsibility Matrix Overview

| Capability | Core | VS Code | Chrome | A11y Agent |
|------------|------|---------|--------|------------|
| Pattern definition | ✓ sole | — | — | — |
| Pattern matching | Central hub | Local cache | Local cache | Local cache |
| Plaintext access | ✓ sole | — | — | — |
| Clipboard write | ✓ sole | — | — | — |
| Masking rendering | — | Editor decoration | DOM overlay | System-level |
| Key extraction | Aggregation | Detection | Detection | Detection |
| State management | Primary | Receiver | Receiver | Receiver |
| Offline operation | N/A | ✓ available | ✓ available | ✓ available |
