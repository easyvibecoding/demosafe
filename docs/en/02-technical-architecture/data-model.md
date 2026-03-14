# Data Model

## Core Entities

### KeyEntry

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | UUID | Required | Unique identifier for the key entry |
| `label` | String | Required | User-friendly key name |
| `serviceId` | UUID | Required | Reference to the parent Service |
| `encryptedValue` | Data (Keychain) | Required | Plaintext stored only in macOS Keychain |
| `pattern` | String (regex) | Required | Regular expression for detecting this key |
| `maskFormat` | MaskFormat | Required | Display rules: prefix, suffix, mask character, separator |
| `shortcutIndex` | Int? | Optional | Hotkey index for quick paste (1-9) |
| `linkedGroupId` | UUID? | Optional | Reference to the parent LinkedGroup |
| `createdAt` | Date | Auto | Creation timestamp |
| `updatedAt` | Date | Auto | Last modified timestamp |

### Service

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | UUID | Required | Unique identifier for the service |
| `name` | String | Required | Service name (e.g., AWS, GitHub) |
| `icon` | String? | Optional | Service icon reference |
| `defaultPatterns` | [String] | Required | Default regex array for this service |
| `children` | [KeyEntry] | Computed | Array of key entries under this service |

### LinkedGroup

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | UUID | Required | Unique identifier for the group |
| `label` | String | Required | User-friendly group name |
| `entries` | [KeyEntry] | Required | Ordered array of key entries |
| `pasteMode` | PasteMode | Required | MVP: only `.selectField` implemented. `.sequential` reserved for future versions |

### MaskFormat

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `showPrefix` | Int | Required | Number of leading characters to display |
| `showSuffix` | Int | Required | Number of trailing characters to display |
| `maskChar` | Character | Required | Mask character (default: `*`) |
| `separator` | String | Required | Separator string between prefix and suffix (default: `...`) |

### ContextMode

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | UUID | Required | Unique identifier for the context |
| `name` | String | Required | Context name (e.g., "Livestream", "Development") |
| `maskingLevel` | Enum | Required | `.full` (full masking) \| `.partial` (partial masking) \| `.off` (off) |
| `clipboardTTL` | Int? | Optional | Clipboard auto-clear time in seconds |
| `activeServiceIds` | [UUID]? | Optional | List of services to mask in this context |
| `shortcutKey` | String? | Optional | Hotkey to activate this context |

> MVP Note: Contexts default to fixed values (Livestream, Development). Dynamic context switching is reserved for future versions.

---

### PasteMode (Enum)

| Value | Description | Phase |
|-------|-------------|-------|
| `.selectField` | User manually selects the field to paste into; toolbox displays all keys in the group for selection | **MVP** |
| `.sequential` | Pressing the hotkey automatically pastes the next key in the group in order (e.g., Access Key ID first, then Secret Key) | Future version |

---

### MaskResult (Return Type)

Return structure of `MaskingCoordinator.shouldMask(text)`:

| Property | Type | Description |
|----------|------|-------------|
| `keyId` | UUID | Identifier of the matched KeyEntry |
| `matchedRange` | Range\<String.Index\> | Matched range in the original text |
| `maskedText` | String | Masked display text (e.g., `sk-proj-****...****`) |
| `pattern` | String | Matched regex pattern |
| `serviceId` | UUID | Identifier of the parent service |

> Returns `nil` when the text does not contain any known pattern.

---

### DetectedKey (Detection Result)

Shared structure for `ClipboardEngine.detectKeysInClipboard()` and Extension `submit_detected`:

| Property | Type | Description |
|----------|------|-------------|
| `rawValue` | String | Detected raw key value |
| `suggestedService` | String? | Service name inferred from pattern prefix |
| `pattern` | String | Matched regex pattern |
| `confidence` | Double (0.0–1.0) | Confidence score: 1.0 = exact match with known pattern; < 0.5 = fuzzy match, requires user confirmation |

> Confidence score calculation is based on: pattern match precision, whether key length falls within expected range, whether prefix exactly matches a known service.

---

## Entity Relationships

```
ContextMode controls → Service (1:N) → KeyEntry → optional LinkedGroup
```

- A single ContextMode can activate multiple Services
- Each Service contains multiple KeyEntries
- A KeyEntry can optionally join a LinkedGroup for field selection or sequential paste operations

## Storage Strategy

| Data Type | Storage Location | Access Control |
|-----------|-----------------|----------------|
| `encryptedValue` (plaintext key) | macOS Keychain (`com.demosafe.key.{UUID}`) | System-level encryption + optional Touch ID |
| Structural data (Service, Group, Context) | `~/Library/Application Support/DemoSafe/vault.json` | File permissions, user-level |
| User preferences | `UserDefaults (com.demosafe)` | User-level preferences |

Keychain uses `kSecAttrAccessible` set to `whenUnlockedThisDeviceOnly`, ensuring keys are only accessible when the device is unlocked.
