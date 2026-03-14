# Floating Toolbox (HUD)

The floating toolbox is the primary interaction interface during presentations. It appears as a compact HUD panel near the cursor.

## Activation Method: Press-and-Hold Model

Inspired by the macOS `⌘Tab` App Switcher.

| Action | Input | Result |
|--------|-------|--------|
| Open toolbox | Press and hold `⌃⌥Space` | HUD appears near cursor, showing Key list |
| Search/filter | Continue holding + type characters | Key list filters in real-time |
| Quick paste (single result) | Release when only 1 result remains | Key is pasted, toolbox disappears |
| Select from multiple results | Release → toolbox locks; use `↑↓` + `Enter` | Press Enter to paste Key, Esc to cancel |
| Paste directly by number | Press `⌃⌥[1-9]` | Immediately paste the Nth Key, no toolbox needed |

## Lock Behavior (Plan B)

When the user releases the hold key and there are still multiple results, the toolbox enters a "locked" state:

- Toolbox remains visible, **no keys need to be held**
- Arrow keys navigate the list
- `Enter` confirms and pastes
- `Esc` closes without pasting
- Clicking a Key item directly also works

> This design prevents accidentally pasting the wrong Key during a live presentation.

## HotkeyManager Press-and-Hold Detection Logic

```
keyDown → Show toolbox → Listen for typing → Forward to search field
keyUp → Determine:
  - Results = 1 → Paste directly
  - Results > 1 → Lock toolbox, wait for user selection
```
