# Swift Core Modules

## Module Overview

The core engine consists of six major modules, coordinated by `DemoSafeApp`:

```
DemoSafeApp (SwiftUI)
├── VaultManager          // vault.json CRUD
├── KeychainService       // Sole point of plaintext access
├── ClipboardEngine       // Sole writer to NSPasteboard
├── HotkeyManager         // Global hotkeys (CGEvent)
├── MaskingCoordinator    // Masking state hub + pattern matching
└── IPCServer             // localhost WebSocket
```

---

## VaultManager

Manages `vault.json` read/write and CRUD operations for all structural data (Service, KeyEntry, LinkedGroup, ContextMode).

### Main Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `addKey(label, serviceId, pattern, maskFormat, value)` | `throws → KeyEntry` | Create new KeyEntry, store value to Keychain, broadcast via NotificationCenter |
| `deleteKey(keyId)` | `throws → Void` | Remove KeyEntry from vault, delete from Keychain |
| `getKeys(serviceId)` | `→ [KeyEntry]` | Get all KeyEntries under a service |
| `createLinkedGroup(label, keyIds, pasteMode)` | `throws → LinkedGroup` | Create an ordered LinkedGroup |
| `getLinkedGroup(groupId)` | `→ LinkedGroup?` | Get full LinkedGroup details; returns nil if not found |
| `activeContext()` | `→ ContextMode` | Return the currently active ContextMode |
| `switchContext(contextId)` | `throws → Void` | Switch context and broadcast state change; persist to disk |
| `exportStructure()` | `throws → Data` | Export vault.json contents for backup |
| `importStructure(data)` | `throws → Void` | Import vault.json from backup; validate then overwrite local |

### Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| vault.json corrupted | Attempt auto-recovery from `vault.json.backup`; on failure, notify user and create empty vault |
| Keychain write failure | Roll back vault.json changes; display error message to user |
| Disk write race condition | Use atomic write (write to temp file then rename) to prevent partial writes |

> VaultManager writes to disk on every structural change and broadcasts notifications to all system components via NotificationCenter.

---

## KeychainService

Pure Keychain CRUD operations with no business logic. **This is the only module that accesses plaintext keys.**

### Configuration

| Item | Value |
|------|-------|
| Service prefix | `com.demosafe.key` |
| kSecAttrAccessible | `whenUnlockedThisDeviceOnly` |
| Touch ID | User can enable in settings |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `storeKey(keyId, value)` | `throws → Void` | Encrypt and store value to Keychain |
| `retrieveKey(keyId)` | `throws → Data` | Retrieve plaintext from Keychain |
| `deleteKey(keyId)` | `throws → Void` | Remove key from Keychain |

### Error Scenarios

| Error | Cause | Description |
|-------|-------|-------------|
| `keychainItemNotFound` | No item for keyId | Triggered on retrieveKey / deleteKey |
| `keychainDuplicateItem` | Same keyId already exists | Triggered on storeKey |
| `keychainAuthFailed` | Device locked or Touch ID rejected | Triggered on retrieveKey |
| `keychainUnexpected(OSStatus)` | Other Security.framework errors | Wraps raw OSStatus code |

---

## ClipboardEngine

Manages all clipboard operations and key detection in clipboard contents.

### Critical Operation Flow

`copyToClipboard(keyId)` is **the only path for plaintext to leave the Keychain**:

1. Retrieve plaintext from Keychain
2. Write to NSPasteboard
3. Zero-clear the plaintext variable

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `copyToClipboard(keyId)` | `throws → Void` | The only plaintext output path; no plaintext residue on failure |
| `clearClipboard()` | `→ Void` | Immediately clear NSPasteboard |
| `startAutoClear(seconds)` | `→ Void` | Schedule auto-clear; resets timer on repeated copy |
| `detectKeysInClipboard()` | `→ [DetectedKey]` | Scan clipboard contents against all patterns |

### Edge Case Behavior

| Scenario | Handling |
|----------|----------|
| Consecutive copy of same key | Reset autoClear timer; no duplicate write |
| Consecutive copy of different keys | Clear previous timer; write new key and start new timer |
| External program clears clipboard | autoClear timer expires naturally; clearClipboard becomes no-op |
| copyToClipboard failure | Do not write to NSPasteboard; do not start autoClear; display error to user |

### DetectedKey Structure

See full definition at [data-model.md → DetectedKey](data-model.md#detectedkey-detection-result).

Brief: `rawValue`, `suggestedService`, `pattern`, `confidence` (0.0–1.0 confidence score)

---

## HotkeyManager

Manages global keyboard shortcuts using `CGEvent.tapCreate` for system-level hotkey interception.

### Registered Hotkeys

| Hotkey | Method | Description |
|--------|--------|-------------|
| `⌃⌥Space` | `toggleToolbox()` | Show/hide floating toolbox |
| `⌃⌥⌘D` | `toggleDemoMode()` | Toggle demo/normal mode |
| `⌃⌥⌘[1-9]` | `pasteKeyByIndex()` | Paste key by shortcut index |
| `⌃⌥⌘V` | `captureClipboard()` | Scan and save current clipboard contents |

### Hold-to-Detect Logic

```
keyDown → show toolbox → listen for typing → forward to search field
keyUp → decide paste or lock
```

### Other Methods

| Method | Description |
|--------|-------------|
| `register(action, modifiers, keyCode)` | Register a hotkey |
| `unregister(action)` | Unregister a hotkey |
| `detectConflicts() → [ConflictingApp]` | Detect hotkey conflicts |

---

## MaskingCoordinator

Masking state hub. Publishes `isDemoMode` and `activeContext` as `@Published` properties for SwiftUI binding.

### @Published Properties

| Property | Type | Description |
|----------|------|-------------|
| `isDemoMode` | `Bool` | Demo mode toggle; SwiftUI binding drives Menu Bar icon state |
| `activeContext` | `ContextMode` | Currently active context; drives masking level and clipboard policy |

### Main Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `shouldMask(text)` | `→ [MaskResult]` | Scan text for all matching patterns; return all match results array; returns empty array if no matches |
| `maskedDisplay(keyId)` | `→ String` | Return masked representation of key for UI display |
| `broadcastState()` | `→ Void` | Send current state to all connected Extensions via IPCServer |

### MaskResult Structure

See full definition at [data-model.md → MaskResult](data-model.md#maskresult-return-type).

### Pattern Matching Strategy

| Item | Description |
|------|-------------|
| Match order | Descending by pattern length (more specific patterns first) |
| Regex compilation | All patterns compiled to `NSRegularExpression` once at startup; cached for reuse |
| Thread safety | Pattern cache is a read-only snapshot; replaced via copy-on-write on changes |
| Performance | Single-pass scan matches all patterns simultaneously; avoids redundant traversals |

> All pattern matching is centralized in MaskingCoordinator. Extensions subscribe to state changes and synchronize their local cache through this coordination point.

---

## IPCServer

localhost WebSocket server with auto-assigned port. Tracks connected clients by type (vscode, chrome, accessibility).

### Port Discovery Mechanism

IPCServer creates `~/.demosafe/ipc.json` containing `{port, pid, version}` for Extensions to discover connection info.

### Main Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start(preferredPort: UInt16?)` | `throws → UInt16` | Start WebSocket server; returns the actual bound port |
| `stop()` | `→ Void` | Close all connections and stop listening |
| `broadcast(event, to: ClientType?)` | `→ Void` | Broadcast event to specified type or all connected clients |
| `connectedClients()` | `→ [ClientInfo]` | Return list of currently connected clients |

### Main Responsibilities

- Handle WebSocket connections and verify via handshake token
- Route Extension requests (`get_state`, `request_paste`, `submit_detected`) to corresponding handlers
- Broadcast events (`state_changed`, `pattern_cache_sync`, `key_updated`, `clipboard_cleared`) to all connected clients

### ipc.json Full Structure

```json
{
  "port": 49152,
  "pid": 12345,
  "version": "1.0.0",
  "token": "random-256bit-hex-string"
}
```

- Token is regenerated on every Core startup (`SecRandomCopyBytes` generates 32 bytes → hex encoded)
- Old tokens are immediately invalidated after Core restart; Extensions must re-read ipc.json and re-handshake

---

## Module Dependency Graph

```
HotkeyManager → MaskingCoordinator → VaultManager → KeychainService
MaskingCoordinator → IPCServer → ClipboardEngine
```

Dependencies form a directed acyclic graph (DAG), ensuring:
- Clear data flow direction
- Testability of individual modules
- Easy dependency injection
- **No circular dependencies**
