# Smart Key Extraction Confirmation Dialog Spec

> Last updated: 2026-03-18

## Overview

The Smart Key Extraction confirmation dialog is an inline content script UI in the Chrome Extension. When a detected key's confidence falls between 0.35 and 0.7 (medium tier), the system masks the key first, then displays a confirmation dialog for the user to decide whether to store it.

---

## Three-Tier Confidence Strategy

| Confidence Range | Action | Description |
|-----------------|--------|-------------|
| >= 0.7 (high) | Auto-store | Send `submit_captured_key` to Core directly, show toast |
| 0.35 ~ 0.7 (medium) | Mask + confirmation dialog | Mask plaintext first, show inline dialog for user confirmation |
| < 0.35 (low) | Ignore | No processing, no masking |

---

## Confirmation Dialog UI Design

```
+--------------------------------------------------+
|  DemoSafe: Detected possible API key              |
|                                                    |
|  Service name: [__openai______________]  (editable)|
|  Key preview:  sk-proj-...xxxx                     |
|                                                    |
|  [ Confirm & Store ]     [ Reject ]       (27s)    |
+--------------------------------------------------+
```

### UI Elements

| Element | Description |
|---------|-------------|
| Title | "DemoSafe: Detected possible API key" |
| Service name | Editable text input, defaults to detected platform name |
| Key preview | Masked key preview (prefix + ...last 4 chars) |
| Confirm & Store | Confirm button, submits to Core for storage |
| Reject | Reject button, restores original text and adds to rejectedKeys |
| Countdown | Bottom-right displays remaining seconds, 30s auto-dismiss |

### Behavior Table

| Action | Behavior |
|--------|----------|
| Confirm | Send `submit_captured_key` to background -> Core, close dialog, key stays masked |
| Reject | Restore key's original text, add to `rejectedKeys` Set, close dialog |
| Escape | Same as Reject |
| 30s timeout | Auto-dismiss, key stays masked (neither submitted nor restored) |

---

## Queue Mechanism

When multiple medium-confidence keys are detected simultaneously on a page, dialogs are shown sequentially via a queue:

1. First key's dialog appears immediately
2. Subsequent keys are added to the `pendingConfirmations` queue
3. After previous dialog closes, the next one automatically appears
4. Each dialog has its own independent 30s countdown

---

## Deduplication Mechanism

Three Sets prevent duplicate processing:

| Set | Purpose | Lifetime |
|-----|---------|----------|
| `submittedKeys` | Keys already submitted to Core (high-confidence auto + confirmed) | Page lifetime |
| `rejectedKeys` | Keys rejected by the user | Page lifetime |
| `isAlreadyStoredKey()` | Query Core for known keys (via pattern matching) | Real-time query |

Flow: key detected -> check submittedKeys / rejectedKeys / isAlreadyStoredKey -> skip if exists -> otherwise route by confidence tier.

---

## Universal Masking / Detection Toggles

### Popup UI

Two independent toggle switches in the popup panel:

- **Universal Masking**: Enable DOM masking on non-supported platform pages (default OFF)
- **Universal Detection**: Enable key detection on non-supported platform pages (default OFF)

### Default Behavior

- Supported platforms (11+ platforms defined in capture-patterns.ts): Demo Mode automatically enables masking and detection, unaffected by toggles
- Non-supported platforms: Only enabled when corresponding toggle is ON

### Decision Functions

| Function | Logic |
|----------|-------|
| `shouldMask(url)` | `isSupportedPlatform(url) \|\| universalMaskingEnabled` |
| `shouldAutoCapture(url)` | `isSupportedPlatform(url) \|\| universalDetectionEnabled` |

### Storage

Stored in `chrome.storage.local` with keys `universalMasking` and `universalDetection`.

---

## Generic Key Pattern

| Property | Value |
|----------|-------|
| Pattern ID | `generic-key` |
| Confidence | 0.50 |
| Prefix | `""` (empty string) |
| Match rule | Common prefixes (key-, token-, api-, secret-, sk-, pk-, rk-) + 30+ alphanumeric chars |
| Special handling | `KEY_PREFIXES` filters empty string prefix to prevent `containsFullKey()` false positives |

This pattern captures API keys on non-supported platforms, used in conjunction with Universal Detection. Since confidence is 0.50 (medium tier), it triggers the confirmation dialog.

---

## IPC Flow Diagram (Medium-Confidence Key)

```
Content Script                 Background SW              Core Engine
     |                              |                         |
     |  Key detected (0.35~0.7)     |                         |
     |  Mask plaintext              |                         |
     |  Show confirmation dialog    |                         |
     |                              |                         |
     |  [User clicks Confirm]       |                         |
     |                              |                         |
     |-- submit_captured_key ------->|                         |
     |   {key, serviceName}         |                         |
     |                              |-- submit_captured_key -->|
     |                              |   {key, serviceName}    |
     |                              |                         |
     |                              |<-- key_stored ----------|
     |                              |   {keyId, masked}       |
     |<-- key_stored ---------------|                         |
     |                              |                         |
     |  Show toast                  |                         |
```

---

## New Message Types

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `submit_captured_key` | Content -> BG -> Core | `{ key: string, serviceName: string, platform: string }` | Submit captured key |
| `key_stored` | Core -> BG -> Content | `{ keyId: string, masked: string }` | Key stored confirmation |
| `get_universal_settings` | Popup -> BG | `{}` | Get universal toggle states |
| `set_universal_settings` | Popup -> BG | `{ masking: boolean, detection: boolean }` | Set universal toggles |
| `universal_settings_changed` | BG -> Content | `{ masking: boolean, detection: boolean }` | Broadcast toggle state changes |

---

## File Changes Table

| File | Changes |
|------|---------|
| `packages/chrome-extension/src/content/masker.ts` | Three-tier confidence routing, confirmation dialog UI, queue mechanism, rejectedKeys |
| `packages/chrome-extension/src/content/confirmation-dialog.ts` | Dialog component: creation, events, countdown, Escape |
| `packages/chrome-extension/src/content/capture-patterns.ts` | Add `generic-key` pattern |
| `packages/chrome-extension/src/background/service-worker.ts` | Universal settings storage/broadcast |
| `packages/chrome-extension/src/popup/popup.ts` | Universal Masking / Detection toggle UI |
| `packages/chrome-extension/src/popup/popup.html` | Toggle HTML structure |
| `packages/chrome-extension/src/content/pre-hide.ts` | `turbo:before-render` listener |
| `packages/chrome-extension/src/content/toast.ts` | Duration changed to 25s |
