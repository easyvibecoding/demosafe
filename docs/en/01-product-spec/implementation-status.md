# Implementation Status Tracking

> Last updated: 2026-03-18

## Status Legend

- ✅ Completed
- 🔶 Partially completed
- ❌ Not started
- 🔮 Future goal

---

## Swift Core Engine

| Module | Status | Notes |
|--------|--------|-------|
| VaultManager (CRUD, vault.json) | ✅ | Service / KeyEntry / ContextMode CRUD completed |
| KeychainService | ✅ | store / retrieve / delete completed |
| ClipboardEngine | ✅ | copy + autoClear + detectKeys completed |
| MaskingCoordinator | ✅ | isDemoMode / activeContext / pattern matching completed |
| IPCServer (WebSocket) | ✅ | handshake / state_changed / pattern_cache_sync / toggle_demo_mode / nmh clientType |
| HotkeyManager | ✅ | `⌃⌥⌘D` toggle, `⌃⌥Space` hold detection, `⌃⌥⌘[1-9]` paste, flagsChanged listener |
| Floating Toolbox (HUD) | ✅ | NSPanel floating window, hold-to-search, Scheme B lock, ↑↓ navigation |
| ToolboxState (ViewModel) | ✅ | Search filtering, selection state, release/confirm/dismiss logic |
| FloatingToolboxController | ✅ | NSPanel management, cursor positioning, locked mode makeKey |
| Menu Bar App | ✅ | Native menu style, Demo Mode toggle, Settings window |
| SettingsWindowController | ✅ | Standalone NSWindow, opens properly from menu bar app |
| Settings UI | 🔶 | Basic tab framework, Key management + Add Service completed |

### Core Features Not Yet Implemented

| Feature | Spec Section | Priority | Notes |
|---------|-------------|----------|---------|
| ~~`⌃⌥⌘V` capture clipboard~~ | Spec §4.4 | ~~Medium~~ | ✅ HotkeyManager → ClipboardEngine.detectKeysInClipboard() → 22 built-in patterns → 3-tier confidence routing → VaultManager store |
| ~~Linked Key Groups (sequential paste)~~ | Spec §6.3 | ~~Medium~~ | ✅ `LinkedGroup`/`GroupEntry`/`SequentialPasteEngine` complete, Settings UI group management (CRUD), `request_paste_group` IPC handler |
| ~~Terminal masking (Shielded Terminal)~~ | Spec §3.2 | ~~Medium~~ | 🧪 Experimental. node-pty proxy + DEC 2026 sync block buffering + ANSI-aware masking. Known limitation: Rewind confirmation page partial leak |
| Shortcut conflict detection | Spec §4.4 | Low | |
| Import / Export vault | Spec §9.1 | Low | |

> **Note**: Smart Key Extraction Chrome ↔ Core IPC is fully implemented (`submit_captured_key` → `handleSubmitCapturedKey` → VaultManager + Keychain → `pattern_cache_sync` broadcast). The table above lists only features that are genuinely not yet implemented.

---

## VS Code Extension

| Feature | Status | Notes |
|---------|--------|-------|
| IPC WebSocket connection | ✅ | exponential backoff reconnect |
| Pattern cache sync | ✅ | Offline still uses cached patterns |
| Editor Decoration masking | ✅ | `letterSpacing: '-1em'` + padded masked text |
| Status bar state display | ✅ | Connected / Offline / No Cache |
| Demo Mode toggle command | ✅ | Command palette + IPC |
| Paste key command | ✅ | Via IPC request_paste |
| Terminal masking (node-pty) | 🔮 | See `files_demo/`; see memory |

### Fixed Issues

- Decoration text compression: Original text hidden with `opacity: '0'` + `letterSpacing: '-1em'`, masked text padded to original length
- Gutter icon not found: Reference removed

### Known Notes

- **Keychain ACL**: Test keys added via `security` CLI will trigger system permission prompts when DemoSafe reads them. Keys must be added via `SecItemAdd` API (i.e., `KeychainService.storeKey` or equivalent Swift code) for the app's ACL to be correctly set.

---

## Chrome Extension

| Feature | Status | Notes |
|---------|--------|-------|
| Background Service Worker | ✅ | WebSocket connection, NMH fallback dual-path dispatch, state management, reconnect |
| Popup UI | ✅ | Connection status (WebSocket/NMH/Offline), Demo Mode, Context, Patterns |
| Toggle Demo Mode | ✅ | Popup → Background → Core → broadcast |
| Content Script DOM masking | ✅ | TreeWalker + CSS overlay + MutationObserver |
| Content Script unmask | ✅ | Restore original text when exiting Demo Mode |
| Options page | ✅ | Pattern cache management + Dev IPC Config |
| Dev IPC Config (workaround) | ✅ | Alternative to Native Messaging Host |
| Native Messaging Host | ✅ | get_config + WS relay (get_state / submit_captured_key / toggle_demo_mode) |
| Dual-path IPC (NMH fallback) | ✅ | WS primary + NMH fallback, popup shows connection path |
| NMHInstaller (Core auto-install) | ✅ | Core installs binary + manifest from bundle Resources on startup |
| Active Key Capture | ✅ | 4-layer detection: DOM scan → attribute → clipboard → platform selectors |
| capture-patterns.ts (SSoT) | ✅ | 11 platform pattern definitions, single file maintenance |
| Pre-hide anti-flash | ✅ | 3 layers: manifest CSS → pre-hide.ts → instant MutationObserver |
| Per-platform CSS isolation | ✅ | 12 separate CSS files, generated at build time |
| Clipboard writeText interception | ✅ | `clipboard-patch.ts` MAIN world, supports AI Studio/AWS/Stripe |
| React SPA masking | ✅ | Dialog inputs stay hidden, no value replacement |
| AWS dual-key capture | ✅ | Access Key ID (DOM) + Secret Key (clipboard) |
| Toast stacking | ✅ | Consecutive captures show stacked toasts |
| Smart Key Extraction confirmation dialog | ✅ | Three-tier confidence strategy + confirmation UI + reject restore |
| Universal Masking / Detection | ✅ | Popup dual toggles, extend to non-supported platforms |
| Generic key pattern | ✅ | Generic prefix detection (confidence 0.50) |
| Turbo navigation anti-flash | ✅ | turbo:before-render pre-hide |
| Capture Mode (popup) | ✅ | Start/Stop capture + countdown timer |
| E2E tested (8 platforms) | ✅ | GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS |
| Stripe / Slack / SendGrid | 🔶 | Patterns defined, untested |

### Fixed Issues

- Content script initial state out of sync: Proactively requests `get_state` from background on load
- `toggle_demo_mode` action incorrectly sending `get_state`: Fixed
- GitLab 2026 redesign: selectors updated from `#created-personal-access-token` to `.gl-alert-success`
- OpenAI React SPA: `input.value` overwritten by framework causing plaintext exposure, switched to CSS hiding
- AWS Secret Key `trimmed` variable undefined: fixed to `text.trim()`
- preHideCSS too broad: OpenAI `input[type="text"]` hid Name input, narrowed scope

---

## CI/CD

| Item | Status |
|------|--------|
| ESLint (VS Code Extension) | ✅ |
| ESLint (Chrome Extension) | ✅ |
| Build (all workspaces) | ✅ |

---

## Development Sequence Reference

Per Spec §9 Roadmap:

### Phase 1: Swift Core Skeleton ✅
1. ~~Create project~~ ✅
2. ~~KeychainService~~ ✅
3. ~~VaultManager~~ ✅
4. ~~MaskingCoordinator~~ ✅
5. ~~Menu Bar UI~~ ✅

### Phase 2: Clipboard + Hotkeys ✅
6. ~~ClipboardEngine~~ ✅
7. ~~HotkeyManager (hold detection + flagsChanged + keystroke forwarding)~~ ✅
8. ~~Floating Toolbox HUD (NSPanel + hold-to-search + Scheme B lock + `⌃⌥⌘[1-9]` paste)~~ ✅

### Phase 3: IPC + VS Code Extension ✅
9. ~~IPCServer~~ ✅
10. ~~VS Code Extension project~~ ✅
11. ~~Pattern cache sync~~ ✅
12. ~~Decoration API masking~~ ✅
13. ~~Offline degradation~~ ✅

### Phase 4: Integration Testing ✅
14. ~~End-to-end testing~~ ✅ (manual)
15. Offline testing 🔶 (not formally verified)
16. Hotkey conflict testing ❌

### Ahead of Schedule: Chrome Extension ✅
- ~~WebSocket connection~~ ✅
- ~~Content Script masking~~ ✅
- ~~Toggle Demo Mode~~ ✅

### Phase 5: Active Key Capture ✅
- ~~capture-patterns.ts SSoT~~ ✅
- ~~Per-platform CSS isolation~~ ✅
- ~~Pre-hide anti-flash (3 layers)~~ ✅
- ~~Clipboard writeText interception~~ ✅
- ~~React SPA masking~~ ✅
- ~~AWS dual-key capture~~ ✅
- ~~Toast stacking~~ ✅
- ~~E2E tested 8 platforms~~ ✅
- Stripe / Slack / SendGrid 🔶

### Phase 6: Cross-Platform Support 🔮

The three-layer separation allows full reuse of the Extension layer (VS Code + Chrome). Only the System Layer needs reimplementation:

```
[VS Code Extension] ── IPC ──┐
                             │
[Chrome Extension] ── IPC ───┤── [System Layer]
                             │
System Layer = SecretStore + Demo Mode + IPC
  ├─ macOS: Keychain + SwiftUI          ← current
  ├─ Windows: Credential Manager + WinUI/WPF
  └─ Ubuntu: libsecret + GTK/Qt
```

| Component | macOS (current) | Windows | Ubuntu |
|-----------|----------------|---------|--------|
| Secret Store | Keychain | Credential Manager (DPAPI) | libsecret (GNOME Keyring) |
| IPC Server | NWListener WebSocket | .NET/Rust WebSocket | Rust WebSocket |
| NMH Binary | Swift CLI | .exe (C#/Rust) | ELF (Rust) |
| System Tray | MenuBarExtra (SwiftUI) | WinUI NotifyIcon | GTK StatusIcon |
| Hotkey | CGEvent + HotkeyManager | RegisterHotKey API | X11 XGrabKey |
| Clipboard | NSPasteboard | Win32 Clipboard API | xclip / wl-clipboard |

**No changes needed**: Chrome Extension, VS Code Extension, shared/ipc-protocol, capture-patterns.ts

**Recommended strategy**: Implement System Layer in Rust for cross-compilation. Use native GUI shells per platform.
