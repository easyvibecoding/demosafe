# VS Code Extension Architecture

> Status: ✅ Core features completed (IPC connection, Editor Decoration, Status Bar)
> Future goal: Terminal masking (node-pty + Pseudoterminal)

---

## System Architecture

```
┌──────────────────────────────────────────────┐
│               VS Code Extension               │
│                                                │
│  ┌──────────────┐  ┌────────────────────────┐ │
│  │ IPCClient    │  │ DecorationManager      │ │
│  │ (WebSocket)  │→ │ (TextEditorDecoration)  │ │
│  └──────┬───────┘  └────────────────────────┘ │
│         │           ┌────────────────────────┐ │
│         │           │ StatusBarManager       │ │
│         │           │ (StatusBarItem)        │ │
│         │           └────────────────────────┘ │
│         │           ┌────────────────────────┐ │
│         │           │ PatternCache           │ │
│         │           │ (JSON file cache)      │ │
│         │           └────────────────────────┘ │
└─────────┼──────────────────────────────────────┘
          │ WebSocket ws://127.0.0.1:{port}
          ↓
┌──────────────────┐
│ Swift Core       │
│ IPCServer        │
└──────────────────┘
```

---

## Component Description

### IPCClient (`ipc-client.ts`)

**Responsibilities**:
- Read `~/.demosafe/ipc.json` to obtain connection info
- Establish WebSocket connection to Core (using `ws` npm package)
- Send handshake (clientType: 'vscode')
- Receive and dispatch events (stateChanged, patternsUpdated, clipboardCleared)
- Exponential backoff reconnection (1s → 2s → 4s → max 30s + jitter)

**Events**:
| Event | Description |
|-------|-------------|
| `connected` | Handshake successful |
| `disconnected` | Connection lost |
| `stateChanged` | Demo Mode or Context change |
| `patternsUpdated` | Pattern cache update |
| `clipboardCleared` | Clipboard cleared |
| `log` | Internal log forwarded to OutputChannel |

### DecorationManager (`decoration-manager.ts`)

**Masking Strategy**:

Original text is hidden via `opacity: '0'` + `letterSpacing: '-1em'` (visually zero width).
Masked text is displayed via `after` pseudo-element, padded to the original key length to avoid layout shift.

```
Original: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890
Display:  sk-****************************...********
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ equal width to original
```

**Core Logic**:
1. On document open / change, scan content with all cached patterns
2. Apply decorations when isDemoMode is true
3. Clear all decorations when isDemoMode is false
4. Create a separate `TextEditorDecorationType` for each unique maskedText (Map-based)

**padMaskedText Algorithm**:
```typescript
function padMaskedText(masked: string, targetLen: number): string {
    if (masked.length >= targetLen) return masked;
    const padCount = targetLen - masked.length;
    const midpoint = Math.floor(masked.length / 2);
    return masked.slice(0, midpoint) + '*'.repeat(padCount) + masked.slice(midpoint);
}
```

### PatternCache (`pattern-cache.ts`)

**Responsibilities**:
- Persist patterns received from Core to `globalStoragePath/pattern-cache.json`
- Provide cached patterns for continued masking when Core is offline
- Track `patternCacheVersion` to determine if sync is needed

### StatusBarManager (`status-bar.ts`)

**Status Display**:
| State | Display |
|-------|---------|
| Connected + Demo OFF | `$(shield) Demo-safe` |
| Connected + Demo ON | `$(shield) Demo-safe 🔴 DEMO` |
| Offline (with cache) | `$(shield) Demo-safe ⚠️ Offline` |
| Offline (no cache) | `$(shield) Demo-safe ❌ No Cache` |

---

## Offline Degradation

| Scenario | Behavior |
|----------|----------|
| Core shutdown | Continue masking with cached patterns; status bar shows Offline |
| First install (no cache) | Cannot mask; status bar shows No Cache |
| Core restart | Auto-reconnect (read new ipc.json); re-sync patterns |

---

## Commands

| Command ID | Title | Description |
|-----------|-------|-------------|
| `demosafe.toggleDemoMode` | Toggle Demo Mode | Toggle between demo and normal mode |
| `demosafe.pasteKey` | Paste Key | Open key selection menu and paste |

---

## Future: Terminal Masking

See `files_demo/` reference implementation and [07-known-issues-and-improvements.md](../07-known-issues-and-improvements.md).

**Architecture**: Proxy Terminal (node-pty + Pseudoterminal)
```
VS Code Terminal (what user sees, filtered)
    ↑ writeEmitter.fire(filtered)
Proxy layer (maskSecrets regex filtering)
    ↑ ptyProcess.onData(raw)
node-pty (real shell process)
```
