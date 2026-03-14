# Security Rules

## Security Red Lines (Must Not Violate)

The following rules are Demo-safe's hard security guarantees. **No implementation may ever violate them**:

### 1. Plaintext Keys Exist Only in Keychain

- Not written to `vault.json`
- Not stored in `UserDefaults`
- Not written to any log files
- Not stored in any temp files

### 2. Sole Path for Plaintext Keys

```
Keychain → ClipboardEngine → NSPasteboard
```

- `KeychainService.retrieveKey()` is the only entry point for reading plaintext
- `ClipboardEngine.copyToClipboard()` is the only plaintext output path
- Plaintext variables are zero-cleared immediately after use

### 3. IPC Does Not Transmit Plaintext

- `pattern_cache_sync` carries only regex + masked preview
- `state_changed` carries only mode state
- `key_updated` carries only keyId + pattern, not value
- All keys in IPC messages are transmitted only in masked representation

### 4. WebSocket Binds Only to 127.0.0.1

- Binding to `0.0.0.0` or any external interface is prohibited
- Only localhost connections accepted
- Prevents remote access

### 5. ipc.json Permissions chmod 600

- `~/.demosafe/ipc.json` is readable/writable only by the owner
- Prevents other users or processes from reading connection info

---

## Storage Security

| Data | Location | Security Level |
|------|----------|---------------|
| Plaintext keys | macOS Keychain (`com.demosafe.key.{UUID}`) | System-level encryption + optional Touch ID |
| Structural data | `~/Library/Application Support/DemoSafe/vault.json` | File system permissions |
| Preferences | `UserDefaults` | User-level |
| IPC connection info | `~/.demosafe/ipc.json` | chmod 600 |

### Keychain Access Control

- `kSecAttrAccessible`: `whenUnlockedThisDeviceOnly`
- Keys are only accessible when the device is unlocked
- Optional Touch ID biometric authentication can be enabled

---

## Clipboard Security

| Context Mode | Auto-Clear Policy |
|-------------|-------------------|
| Livestream | Auto-clear after 30 seconds |
| Tutorial Recording | Auto-clear after 10 seconds |
| Internal Demo | Normal clipboard behavior |
| Development | Normal clipboard behavior |

### Clipboard Operation Flow

1. `ClipboardEngine.copyToClipboard(keyId)` retrieves plaintext from Keychain
2. Writes to NSPasteboard
3. Plaintext variable is immediately zero-cleared
4. Based on context mode, schedules `startAutoClear(seconds)` for auto-clear

---

## IPC Security

### Connection Verification

1. Extension reads port and token from `ipc.json`
2. Connects via WebSocket to `ws://127.0.0.1:{port}`
3. Sends `handshake` request with `clientType` and `token`
4. Core verifies token before accepting subsequent requests

### Handshake Token Mechanism

| Item | Description |
|------|-------------|
| Generation method | `SecRandomCopyBytes` generates 32 bytes of cryptographically secure random data → hex encoded to 64-character string |
| Lifecycle | Regenerated on every Core startup; old tokens automatically invalidated after Core shutdown |
| Storage location | Written to `~/.demosafe/ipc.json` (chmod 600) |
| Rotation strategy | Rotated on Core restart; no runtime manual rotation supported (unnecessary since bound to localhost) |
| Verification failure handling | Core returns `AUTH_FAILED` error without closing the connection (allows Extension to re-read ipc.json and retry) |

### Auto-Reconnection

- Exponential backoff: 1s → 2s → 4s → max 30s + random jitter
- Handshake verification must be completed again on reconnection
- Extension should re-read `ipc.json` on reconnection (Core may have restarted; port/token may have changed)

---

## Masking Security Guarantee

> In demo mode, API Key plaintext **must not appear on any display at any time**. This is not a best-effort filter — it is a **hard guarantee**.

### Masking Layer Protection

| Layer | Coverage | Offline Behavior |
|-------|----------|-----------------|
| VS Code Extension | Documents in editor | Continue masking with cached patterns |
| Chrome Extension | Known API pages | Continue masking with cached patterns |
| Accessibility Agent | All applications system-wide | Continue masking with cached patterns |

**Key Principle: Extensions continue operating with the last cached patterns when Core is offline, ensuring protection is maintained even when Core is unavailable.**

---

## activeServiceIds and Security Guarantee Relationship

The `activeServiceIds` field in ContextMode can restrict the scope of services with masking enabled in a specific context. Its security semantics are as follows:

| maskingLevel | activeServiceIds | Behavior |
|-------------|-----------------|----------|
| `.full` | nil (not set) | **All registered keys are fully masked** — hard guarantee holds |
| `.full` | Specific services specified | **Only keys from specified services are masked** — keys from other services are not pattern-matched (equivalent to pausing masking for unlisted services) |
| `.partial` | Any | Displays prefix + suffix, hides only the middle section — suitable for internal demos with reduced security level |
| `.off` | Any | Masking completely disabled — development mode only |

> **Design Decision**: `activeServiceIds` exists to give users flexible control in internal demo scenarios. In the default "Livestream" and "Tutorial Recording" contexts, this field is nil (mask all services), ensuring the hard security guarantee is not affected.
