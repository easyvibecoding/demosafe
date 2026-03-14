# Smart Key Extraction

> Status: ❌ Not yet implemented (Phase 2 scope)

## Overview

Smart Key Extraction allows users to automatically detect and import API Keys from web pages, clipboard, or files, replacing manual one-by-one entry.

---

## Extraction Flow

### Step 1: Scan
Trigger methods (any one):
- Menu Bar → Quick Actions → **Smart Extract Current Page**
- Chrome Extension content script auto-detection
- `⌃⌥⌘V` shortcut (scans clipboard)

Scan sources:
- Web page DOM content (Chrome Extension)
- NSPasteboard clipboard content (ClipboardEngine)
- Open file content (VS Code Extension)

### Step 2: Identify
- Match against the built-in regex pattern library (see [masking-format.md](../../06-pattern-reference/masking-format.md))
- Identify service provider based on Key prefix (e.g., `sk-proj-` → OpenAI)
- Page URL helps boost confidence score (e.g., detected on `console.anthropic.com` → confidence +0.2)

### Step 3: Confirmation Dialog
The system displays an extraction confirmation UI to prevent accidental imports:

```
3 Keys detected:

  ✓ OpenAI API Key          sk-proj-****    → Add to OpenAI group?
  ✓ AWS Access Key ID       AKIA****        → Add to AWS / Production?
  ✓ AWS Secret Key          ****            ↔ Link with above?

  [ Add All ]    [ Confirm One by One ]    [ Cancel ]
```

Dialog features:
- Each detected result can be individually checked / unchecked
- Auto-suggests the owning Service (can be manually changed)
- Linked Keys automatically prompt to create a LinkedGroup
- Displays confidence score; values below threshold (< 0.7) are highlighted in warning color

### Step 4: Save
- After user confirmation, Key values are saved to Keychain (via KeychainService)
- KeyEntry structure is written to vault.json (via VaultManager)
- Triggers `pattern_cache_sync` broadcast to all connected Extensions
- If linking is checked, creates a LinkedGroup

---

## DetectedKey Structure

```typescript
interface DetectedKey {
    rawValue: string;         // Detected raw Key value
    suggestedService: string; // Suggested service name
    pattern: string;          // Matched regex pattern
    confidence: number;       // Confidence score 0.0 ~ 1.0
}
```

### Confidence Score Calculation

| Factor | Score Bonus | Description |
|--------|------------|-------------|
| Exact prefix match | +0.4 | e.g., `sk-proj-`, `AKIA`, `ghp_` |
| Length matches | +0.2 | Key length is within the expected range for that service |
| Page URL match | +0.2 | Detection page is the corresponding service's console |
| Character set fully matches | +0.1 | Specific character sets such as Base64, hex |
| Contextual clues | +0.1 | Nearby text contains "API Key", "Secret", etc. |

---

## Trigger Sources and Flows

### Triggered from Chrome Extension

```
User clicks "Smart Extract" or auto-detection triggers
    ↓
Content Script scans DOM text nodes + input/textarea
    ↓
chrome.runtime.sendMessage({ type: 'submit_detected', payload: DetectedKey[] })
    ↓
Background → WebSocket → Core Engine
    ↓
Core Engine displays confirmation dialog
    ↓
User confirms → Save to Vault + Keychain
```

### Triggered from Clipboard (`⌃⌥⌘V`)

```
User presses ⌃⌥⌘V
    ↓
HotkeyManager → ClipboardEngine.detectKeysInClipboard()
    ↓
Returns [DetectedKey] array
    ↓
Display confirmation dialog
    ↓
User confirms → Save to Vault + Keychain
```

---

## Linked Key Groups

Some services require multiple related Keys (e.g., AWS Access Key ID + Secret Key).

### Features

| Feature | Description |
|---------|-------------|
| **Sequential paste** | One shortcut fills in multiple fields in order (e.g., Access Key ID → Tab → Secret Key) |
| **Field select paste** | Displays a list for the user to choose which Key from the group to paste |
| **Batch export** | Export the entire Key group as an `.env` format block |
| **Dependency tracking** | When a Key in the group is rotated, prompt to update linked Keys |

### LinkedGroup Structure

```swift
struct LinkedGroup: Codable, Identifiable {
    let id: UUID
    var label: String           // e.g., "AWS Production"
    var entries: [GroupEntry]    // Ordered Key list
    var pasteMode: PasteMode    // .sequential or .fieldSelect
}

struct GroupEntry: Codable {
    let keyId: UUID
    let fieldLabel: String      // e.g., "Access Key ID", "Secret Key"
    var sortOrder: Int
}

enum PasteMode: String, Codable {
    case sequential    // Auto-paste in order using Tab
    case fieldSelect   // Show menu for user to choose
}
```

### Sequential Paste Simulation

```
User triggers LinkedGroup paste (⌃⌥[N] mapped to group)
    ↓
1. Paste entries[0].value (Access Key ID)
2. Simulate Tab key
3. Paste entries[1].value (Secret Key)
    ↓
Complete, both fields filled in simultaneously
```
