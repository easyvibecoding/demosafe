# Keyboard Shortcuts

## Default Shortcuts

| Action | Default Shortcut | Design Rationale |
|--------|-----------------|------------------|
| Toggle floating toolbox | `⌃⌥Space` | Left-hand key combination, very few conflicts with applications |
| Toggle demo mode | `⌃⌥⌘D` | Three modifier keys to prevent accidental triggering |
| Paste Nth Key directly | `⌃⌥⌘[1-9]` | Fastest path when Key position is known |
| Quick extract clipboard content | `⌃⌥⌘V` | Paste + auto-parse into manager |

## Custom Settings

- All shortcuts are fully customizable in settings
- **Conflict detection**: Real-time warning when the selected key combination overlaps with system or application shortcuts
- HotkeyManager uses `CGEvent.tapCreate` for system-level interception

## Technical Implementation

### Registration

```swift
HotkeyManager.register(action: .toggleToolbox, modifiers: [.control, .option], keyCode: .space)
```

### Conflict Detection

```swift
HotkeyManager.detectConflicts() → [ConflictingApp]
```

Returns a list of applications that conflict with registered shortcuts.
