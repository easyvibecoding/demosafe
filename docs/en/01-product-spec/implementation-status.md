# Implementation Status Tracking

> Last updated: 2026-03-14

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
| IPCServer (WebSocket) | ✅ | handshake / state_changed / pattern_cache_sync / toggle_demo_mode |
| HotkeyManager (basic) | 🔶 | `⌃⌥⌘D` toggle demo mode completed; other hotkeys not yet implemented |
| Menu Bar App | ✅ | Native menu style, Demo Mode toggle, Settings window |
| SettingsWindowController | ✅ | Standalone NSWindow, opens properly from menu bar app |
| Settings UI | 🔶 | Basic tab framework, Key management + Add Service completed |

### Core Features Not Yet Implemented

| Feature | Spec Section | Priority |
|---------|-------------|----------|
| Floating Toolbox (HUD) | Spec §4.3 | High |
| Hold-to-search + Scheme B lock | Spec §4.3 | High |
| `⌃⌥Space` show/hide toolbox | Spec §4.4 | High |
| `⌃⌥[1-9]` hotkey paste | Spec §4.4 | High |
| `⌃⌥⌘V` capture clipboard | Spec §4.4 | Medium |
| Smart Key Extraction | Spec §6 | Medium |
| Linked Key Groups (sequential paste) | Spec §6.3 | Medium |
| Shortcut conflict detection | Spec §4.4 | Low |
| Import / Export vault | Spec §9.1 | Low |

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

---

## Chrome Extension

| Feature | Status | Notes |
|---------|--------|-------|
| Background Service Worker | ✅ | WebSocket connection, state management, reconnect |
| Popup UI | ✅ | Connection status, Demo Mode, Context, Patterns |
| Toggle Demo Mode | ✅ | Popup → Background → Core → broadcast |
| Content Script DOM masking | ✅ | TreeWalker + CSS overlay + MutationObserver |
| Content Script unmask | ✅ | Restore original text when exiting Demo Mode |
| Options page | ✅ | Pattern cache management + Dev IPC Config |
| Dev IPC Config (workaround) | ✅ | Alternative to Native Messaging Host |
| Native Messaging Host | ❌ | Swift binary not compiled/deployed |
| Smart Extract (scan web pages) | ❌ | Spec §6 |
| Key detection (input/textarea) | 🔶 | detectAndSubmitKeys written but not tested |

### Fixed Issues

- Content script initial state out of sync: Proactively requests `get_state` from background on load
- `toggle_demo_mode` action incorrectly sending `get_state`: Fixed

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

### Phase 2: Clipboard + Hotkeys 🔶
6. ~~ClipboardEngine~~ ✅
7. ~~HotkeyManager (basic)~~ ✅
8. Floating Toolbox HUD ❌

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
