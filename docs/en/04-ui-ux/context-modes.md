# Context Modes

> Status: ✅ Basic functionality complete (4 default contexts, switching, IPC broadcast)
> Not yet complete: Custom context UI, shortcut key binding

---

## Overview

Context modes are preset configuration combinations that control masking behavior, clipboard strategy, and the set of enabled Keys. Different scenarios (livestream, tutorial recording, internal demo, development) require different security levels.

---

## Default Contexts

| Context | Masking Level | Clipboard Auto-Clear | Description |
|---------|--------------|---------------------|-------------|
| **Livestream** | `full` | 30 seconds | Highest security: all Keys fully masked, clipboard cleared quickly |
| **Tutorial Recording** | `full` | 10 seconds | For recording: fully masked, clipboard cleared very quickly |
| **Internal Demo** | `partial` | None | Internal presentation: partial masking, no auto-clear |
| **Development** | `off` | None | Development mode: no masking, convenient for debugging |

---

## Masking Levels

| Level | Behavior |
|-------|----------|
| `full` | All Keys matching known patterns are fully masked |
| `partial` | Only masks services specified in `activeServiceIds` |
| `off` | No masking (equivalent to disabling Demo Mode) |

---

## ContextMode Structure

```swift
struct ContextMode: Codable, Identifiable {
    let id: UUID
    var name: String
    var maskingLevel: MaskingLevel      // .full, .partial, .off
    var clipboardClearSeconds: Int?     // nil = no auto-clear
    var activeServiceIds: [UUID]?       // nil = all services; if specified, only mask these
    var isActive: Bool
}

enum MaskingLevel: String, Codable {
    case full       // All Keys fully masked
    case partial    // Specified services only
    case off        // No masking
}
```

---

## Switching Flow

```
User selects context (Menu Bar → Context Mode Switcher)
    ↓
AppState.switchContext(contextId)
    ↓
VaultManager.switchContext() → Update isActive flag → Write to vault.json
    ↓
MaskingCoordinator.activeContext = new context
    ↓
MaskingCoordinator.broadcastState() → NotificationCenter
    ↓
IPCServer receives notification → broadcast state_changed to all Extensions
    ↓
VS Code Extension / Chrome Extension update masking behavior
```

---

## activeServiceIds Security Semantics

The semantics of `activeServiceIds` is an **allow-list**:

| Value | Behavior |
|-------|----------|
| `nil` | All service Keys will be masked (most secure) |
| `[]` (empty array) | No Keys are masked (equivalent to off) |
| `[serviceA, serviceB]` | Only mask Keys for serviceA and serviceB |

> **Security Principle**: `nil` defaults to full masking enabled, not disabled. This ensures that "forgetting to configure" does not lead to security risks.

---

## Future Extensions

| Feature | Description |
|---------|-------------|
| Custom contexts | Users can create custom contexts in Settings |
| Shortcut key binding | Each context can be bound to a dedicated shortcut (e.g., `⌃⌥1` = Livestream) |
| Scheduled switching | Automatically switch contexts based on time (e.g., calendar integration) |
| Application awareness | Automatically switch when a specific app launches (e.g., OBS opens → Livestream) |
