# IPC Protocol Specification

## Connection Mechanism

### Connection Establishment Flow

1. Core Engine starts and opens a WebSocket on localhost (auto-assigned port)
2. Core writes to `~/.demosafe/ipc.json`: `{port, pid, version}`
3. Extension reads `ipc.json` and connects to `ws://127.0.0.1:{port}`
4. Extension sends `handshake` with `clientType` and authentication token
5. Core validates and then accepts subsequent requests

### Auto-Reconnection Strategy

Exponential backoff: `1s → 2s → 4s → ... → max 30s` (with random jitter)

---

## Message Format

All messages follow a JSON envelope structure:

```json
{
  "id": "UUID",
  "type": "request | response | event",
  "action": "specific_action",
  "payload": { ... },
  "timestamp": "ISO8601"
}
```

---

## Request Actions (Extension → Core)

| Action | Payload | Response |
|--------|---------|----------|
| `handshake` | `clientType`, `token`, `version` | port, pid, patternCache version, connection status |
| `get_state` | (none) | isDemoMode, activeContext, patternCache, version |
| `request_paste` | `keyId` | status (`success` \| `denied` \| `offline`) |
| `request_paste_group` | `groupId`, `fieldIndex` (optional) | status, groupId |
| `submit_detected` | `rawValue`, `suggestedService`, `pattern`, `confidence` | isStored: Bool, keyId (if stored) |
| `resolve_mask` | `keyId`, `maskText` | canUnmask: Bool |

### resolve_mask Use Cases

`resolve_mask` is used by Extensions to confirm with Core whether a specific masked text can be unmasked. Primary use cases:

- **In Management Mode**: User wants to confirm which Key a masked text corresponds to in the settings page
- **Debugging scenarios**: Extension needs to confirm whether pattern matching is correct in Development mode
- `canUnmask` returns `false` in these cases: Demo Mode is active, keyId does not exist, token validation failed

### Success Response Format

```json
{
  "id": "UUID corresponding to the request",
  "type": "response",
  "action": "request_paste",
  "payload": { "status": "success" },
  "timestamp": "ISO8601"
}
```

### Error Response Format

```json
{
  "id": "UUID corresponding to the request",
  "type": "response",
  "action": "request_paste",
  "payload": {
    "status": "error",
    "code": "KEY_NOT_FOUND",
    "message": "Requested keyId does not exist in vault"
  },
  "timestamp": "ISO8601"
}
```

### Error Code Definitions

| Error Code | Description | Trigger Scenario |
|-----------|-------------|-----------------|
| `AUTH_FAILED` | Handshake token invalid or expired | handshake validation failed |
| `KEY_NOT_FOUND` | Specified keyId does not exist | request_paste, resolve_mask |
| `GROUP_NOT_FOUND` | Specified groupId does not exist | request_paste_group |
| `DEMO_MODE_DENIED` | Operation not allowed in Demo Mode | resolve_mask (canUnmask = false) |
| `KEYCHAIN_ERROR` | Keychain access failed | request_paste (device locked or Touch ID rejected) |
| `INVALID_PAYLOAD` | Payload format error or missing required fields | All actions |

---

## Event Actions (Core → Extension)

| Event | Payload | Description |
|-------|---------|-------------|
| `state_changed` | isDemoMode, activeContext | Broadcast when masking state changes |
| `pattern_cache_sync` | version, patternArray, knownKeyLocations | Full cache update for offline resilience (structure detailed below) |
| `key_updated` | action (`add` \| `update` \| `delete`), keyId, pattern | Incremental pattern change |
| `clipboard_cleared` | timestamp | Clipboard cleared notification |

---

## Pattern Cache Sync Strategy

Core maintains a `patternCacheVersion` that increments with each pattern change. Extensions track their local version and request a full sync when behind.

### pattern_cache_sync Payload Structure

```json
{
  "version": 42,
  "patternArray": [
    {
      "keyId": "UUID",
      "serviceId": "UUID",
      "serviceName": "OpenAI",
      "pattern": "sk-proj-[A-Za-z0-9_-]{20,}",
      "maskFormat": { "showPrefix": 8, "showSuffix": 0, "maskChar": "*", "separator": "..." },
      "maskedPreview": "sk-proj-****...****"
    }
  ],
  "knownKeyLocations": [
    {
      "keyId": "UUID",
      "filePaths": ["~/.env", "config/secrets.yaml"],
      "lastSeen": "ISO8601"
    }
  ]
}
```

- `patternArray`: Patterns + masking formats for all enabled Keys (**plaintext not included**)
- `knownKeyLocations`: File paths where Extensions previously reported detecting Keys, used for priority scanning

### Offline Cache Persistence

| Item | Description |
|------|-------------|
| Persistence location | Extension writes cache to local storage (VS Code: globalState / Chrome: chrome.storage.local) |
| Survives restart | ✅ Extension automatically loads last cache after restart |
| Expiration policy | No forced expiration; version comparison and sync occur immediately upon reconnection |
| Never received cache | Extension starts with no cache and Core is offline → cannot mask, status bar shows warning |

### Sync Trigger Timing

| Trigger Event | Sync Type |
|--------------|-----------|
| Key added/deleted/modified | `key_updated` event (incremental) |
| Pattern settings changed | `pattern_cache_sync` event (full) |
| Context switch | `state_changed` event |
| Extension first connection | handshake response includes full cache |

### Key Principle

> Extensions use the last cached patterns to continue masking when Core is offline. This ensures protection is maintained even when Core is unavailable.

---

## Security Constraints

| Rule | Description |
|------|-------------|
| WebSocket on 127.0.0.1 only | Binding to external interfaces is prohibited |
| Handshake authentication | Token from `ipc.json` is required |
| **Plaintext never traverses IPC** | Only masked representations and references flow over the network |
| `ipc.json` permissions 600 | User read/write only |
