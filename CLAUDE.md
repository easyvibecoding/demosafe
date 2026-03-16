# CLAUDE.md

## Project Overview

Demo-safe API Key Manager — macOS system-level tool that masks API keys during demos, livestreams, and tutorials. Three-layer architecture: Swift Core Engine + VS Code Extension + Chrome Extension.

## Git

- **Author**: All commits MUST use `--author="easyvibecoding <easyvibecoding@gmail.com>"`
- **Remote**: `git@github-easyvibecoding:easyvibecoding/SafeApiKeyManager.git` (SSH alias)
- **Convention**: [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- **License**: Apache License 2.0 — all new files must be consistent

## Build Commands

```bash
# TypeScript (from project root)
npm install                    # Install all workspace dependencies
npm run build:all              # Build shared + VS Code + Chrome extensions
npm run lint                   # Lint all TypeScript workspaces
npm run type-check             # Type check all TypeScript workspaces

# Individual packages
npm run build:vscode           # VS Code Extension only
npm run build:chrome           # Chrome Extension only
npm run build:shared           # Shared IPC protocol types only

# Swift Core
cd packages/swift-core
swift build                    # Debug build
swift build -c release         # Release build
swift test                     # Run tests
```

## Project Structure

```
packages/
├── swift-core/              # macOS Menu Bar App (Swift/SwiftUI, macOS 14+)
├── vscode-extension/        # VS Code Extension (TypeScript, esbuild)
└── chrome-extension/        # Chrome Extension (Manifest V3, esbuild)
shared/
└── ipc-protocol/            # Shared IPC type definitions (TypeScript)
docs/                        # Architecture docs (Traditional Chinese)
docs/en/                     # Architecture docs (English)
files_demo/                  # Reference implementation for terminal masking
```

## Architecture

```
[VS Code Extension] <-> [Core Engine (Swift)] <-> [Chrome Extension]
           WebSocket ws://127.0.0.1:{port}
                           |
                   [macOS Keychain]
```

- **IPC**: WebSocket on localhost, auto-assigned port, config at `~/.demosafe/ipc.json`
- **Pattern sync**: Core → Extensions via `pattern_cache_sync` event
- **State sync**: `state_changed` event broadcasts Demo Mode / Context changes

## Security Red Lines

These are absolute rules — never violate them:

1. **Plaintext keys only flow**: Keychain → ClipboardEngine → NSPasteboard. No other path.
2. **IPC never transmits plaintext** — only masked representations and key IDs
3. **WebSocket binds to 127.0.0.1 ONLY** — no 0.0.0.0, no external interfaces
4. **ipc.json permissions 600** — user read/write only
5. **Handshake token required** — refreshed on every Core restart
6. **Never commit real API keys** — use fake/test keys only

## Key Technical Decisions

- **MenuBarExtra**: Must use native menu style (Toggle, Button as direct children). Custom VStack layouts have broken click areas.
- **Settings window**: `SettingsWindowController` with `NSApp.setActivationPolicy(.regular)` + `orderFrontRegardless()` for menu-bar-only apps.
- **NWProtocolWebSocket**: `isComplete` in `receiveMessage` means per-message, NOT per-connection. Only close on error or `.close` opcode.
- **VS Code Decoration**: Hide original text with `opacity: '0'` + `letterSpacing: '-1em'`; show masked text via `after` pseudo-element padded to original length.
- **Chrome Content Script**: Must request `get_state` from background on load to get current Demo Mode state.
- **Floating Toolbox**: Uses `NSPanel` (not NSWindow) with `.nonactivatingPanel` + `.floating` level. Does NOT call `setActivationPolicy(.regular)` — HUD must not show dock icon.
- **HotkeyManager hold detection**: Must listen for `flagsChanged` events (not just keyDown/keyUp) to detect modifier key release. `CGEventType.flagsChanged` is the only way to detect ⌃/⌥ release.
- **Keychain ACL**: Test keys must be added by DemoSafe itself (via `VaultManager.addKey`), NOT by external tools (`security` CLI or separate Swift scripts). Keychain ACL is bound to the creating binary's code signature — every recompile invalidates externally-created entries. DEBUG builds auto-seed test keys via `seedTestKeysIfNeeded()` in AppState.

## Documentation

- `docs/` — Traditional Chinese (primary)
- `docs/en/` — English translations
- Key docs: `docs/01-product-spec/implementation-status.md` for what's done/planned
