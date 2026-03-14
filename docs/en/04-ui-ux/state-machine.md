# State Machine and Operation Modes

## Dual-Mode Architecture

The entire product operates in two fundamental modes:

| Mode | Behavior | Visual Indicator |
|------|----------|-----------------|
| **Management Mode** | Keys can be viewed, organized, and imported in the settings page. Used for preparation before presentations. | Menu Bar icon: default color (monochrome) |
| **Demo Mode** | All Keys are fully masked. Paste operations send the real Key to the clipboard but display the masked version. Recording safe. | Menu Bar icon: **red/orange shield** |

Toggle method: `⌃⌥⌘D` (Control + Option + Command + D). Three modifier keys prevent accidental triggering.

---

## Context Modes

Context modes are preset configuration combinations that control masking behavior, clipboard strategy, and the set of enabled Keys.

| Context | Masking Level | Clipboard Strategy | Use Case |
|---------|--------------|-------------------|----------|
| **Livestream** | All surfaces fully masked | Auto-clear after 30 seconds | Product launches, live demos |
| **Tutorial Recording** | All surfaces fully masked | Auto-clear after 10 seconds | YouTube, educational content |
| **Internal Demo** | Partial masking (show prefix + last 4 characters) | Normal clipboard behavior | Team meetings, internal presentations |
| **Development** | Masking disabled | Normal clipboard behavior | Personal development, debugging |

Users can create custom context modes and bind them to specific shortcuts.

### ContextMode Data Structure

| Property | Type | Description |
|----------|------|-------------|
| `maskingLevel` | Enum | `.full` \| `.partial` \| `.off` |
| `clipboardTTL` | Int? | Auto-clear timeout in seconds |
| `activeServiceIds` | [UUID]? | Services with masking enabled in this context |
| `shortcutKey` | String? | Shortcut to activate this context |

> MVP Note: Context presets are fixed values (Livestream, Development); dynamic context switching is reserved for future versions.
