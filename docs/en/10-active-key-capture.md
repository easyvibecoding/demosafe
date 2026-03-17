# Active API Key Web Capture

> Status: ✅ Implemented (Phase 5)
> 8 platforms E2E tested: GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS
> See [Supported Platforms](13-supported-platforms.md) and [Platform Capture Strategies](../11-platform-specific-capture-strategies.md)

---

## Overview

Currently users must manually copy API Keys and then add them in Demo-safe. Active capture mode lets users enable "Capture Mode" from the Menu Bar or Chrome Extension, which automatically detects and captures API Keys appearing on web pages without manual copying.

---

## User Flow

```
1. User enables "Key Capture" mode from Menu Bar or Chrome Extension popup
2. User navigates to an API management page (e.g., platform.openai.com -> API Keys -> Create)
3. The moment the page generates a Key, Chrome Extension automatically detects and captures it
4. Demo-safe shows a confirmation notification: "Detected OpenAI API Key, add to vault?"
5. User confirms -> Key is saved directly to Keychain, never lingering on screen
6. Capture mode automatically closes (or is manually closed)
```

---

## Two Trigger Methods

### Menu Bar Trigger

```
Menu Bar -> Quick Actions -> "Start Key Capture"
    |
IPCServer broadcast -> Chrome Extension enables capture mode
    |
Content Script begins active scanning
    |
Key detected -> submit_detected -> Core shows confirmation
```

### Chrome Extension Popup Trigger

```
Popup -> "Start Capture" button
    |
Background -> notifies all Content Scripts to enable capture mode
    |
Content Script begins active scanning
    |
Key detected -> Background -> WebSocket -> Core shows confirmation
```

---

## Content Script Capture Strategies

### Passive Mode (Existing) vs Active Mode (New)

| Dimension | Passive Mode (Existing) | Active Capture Mode (New) |
|-----------|------------------------|--------------------------|
| Trigger | Always running | User explicitly enables |
| Behavior | Masks known patterns | Detects new Keys and submits |
| Targets | Text nodes on page | Text nodes + inputs + clipboard + dynamic elements |
| Result | Visual masking | Captures Key value to Core |

### Active Mode Scan Targets

1. **DOM Text Nodes**: TreeWalker scans Key-format text in `<code>`, `<pre>`, `<span>` elements
2. **Input / Textarea**: API management pages often display generated Keys in input fields
3. **Dynamic Content**: MutationObserver watches DOM changes, immediately detecting newly appeared Keys
4. **Clipboard Monitoring**: When the user copies on the page, intercept clipboard content and match against patterns
5. **Modal / Dialog**: Many platforms display Keys one-time in modals (e.g., OpenAI's "Copy" button area)

### Key Generation Page Characteristics by Platform

| Platform | Key Appearance Location | Special Behavior |
|----------|------------------------|-----------------|
| OpenAI | Modal dialog with Copy button | Key displayed only once, cannot be viewed again after closing |
| Anthropic | `<code>` element on page | Same as above, one-time display |
| AWS IAM | CSV download or page display | Access Key + Secret Key appear simultaneously |
| Stripe | Inline display in Dashboard | Restricted Keys can be viewed repeatedly |
| GitHub | Displayed on page after token generation | Shown only once |
| Google Cloud | JSON file download | Not displayed on page, requires download interception |

---

## IPC Extensions

### New IPC Actions

**Extension -> Core**:

```json
{
  "type": "request",
  "action": "submit_captured_key",
  "payload": {
    "rawValue": "sk-proj-abc123...",
    "suggestedService": "OpenAI",
    "sourceURL": "https://platform.openai.com/api-keys",
    "confidence": 0.95,
    "captureMethod": "dom_scan"
  }
}
```

**Core -> Extension**:

```json
{
  "type": "event",
  "action": "capture_mode_changed",
  "payload": {
    "isActive": true,
    "timeout": 300
  }
}
```

### New State Fields

```typescript
interface DemoSafeState {
    // Existing
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
    // New
    isCaptureMode: boolean;
    captureTimeout: number | null;  // seconds, null = unlimited
}
```

---

## Security Considerations

| Risk | Countermeasure |
|------|---------------|
| Capturing non-Key text | Do not auto-submit when confidence score < 0.7; require user confirmation |
| Capture mode left on for extended periods | Set timeout (default 5 minutes), auto-close on timeout |
| Page injecting fake Keys for phishing | Match against URL domain allowlist; lower confidence score for unexpected domains |
| Key lingering in memory | Zero-clear temporary values in Content Script immediately after submission |
| Key visible during capture | Immediately trigger DOM masking after successful capture (passive mode takes over) |

---

## Integration with Existing Features

### Seamless Capture -> Masking Handoff

```
Active capture detects Key
    |
submit_captured_key -> Core
    |
Core saves to Keychain + Vault
    |
Triggers pattern_cache_sync -> all Extensions
    |
Content Script passive mode immediately masks that Key
    |
Key is masked on the page; user never sees plaintext from start to finish
```

### Integration with Linked Groups

Platforms like AWS generate multiple related Keys simultaneously (Access Key ID + Secret Key):

```
Captured AKIA... (Access Key ID)
Captured wJal... (Secret Key)
    |
Core detects both originated from console.aws.amazon.com
    |
Automatically proposes creating a LinkedGroup
    |
Confirmation dialog:
  + AWS Access Key ID   AKIA****
  + AWS Secret Key      ****       <-> Link with the above?
  [ Add All ]  [ Confirm Individually ]  [ Cancel ]
```

---

## UI Changes

### Menu Bar

```
Quick Actions:
  +-- Start Key Capture              <-- New (enables capture mode)
  +-- Context Mode Switcher
  +-- Settings...
```

When enabled:
```
  +-- Stop Key Capture (4:32)        <-- Countdown
```

### Chrome Extension Popup

```
+----------------------+
| DemoSafe             |
|                      |
| Connection  * Connected |
| Mode        Demo     |
| Capture     * Active |  <-- New status row
|                      |
| [Stop Capture (4:32)]|  <-- Shown when enabled
| [Enter Demo Mode]    |
+----------------------+
```

### System Notification

On successful capture via macOS notification:
```
Demo-safe: Key Captured
OpenAI API Key has been added to vault
sk-proj-****...****
```
