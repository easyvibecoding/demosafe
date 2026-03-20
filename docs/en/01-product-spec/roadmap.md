# MVP Scope and Development Roadmap

## MVP Scope (Phase 1)

The minimum viable product focuses on the **VS Code + Menu Bar** experience:

- macOS Menu Bar App (Swift/SwiftUI), Keychain-based key storage
- Demo mode toggle with visual indicator
- Floating toolbox with hold-to-search and Scheme B lock
- Keyboard shortcuts: `⌃⌥Space`, `⌃⌥⌘D`, `⌃⌥⌘[1-9]`, `⌃⌥⌘V`
- VS Code Extension with Decoration API masking
- Two-tier key hierarchy and manual key entry
- Basic linked key groups (sequential paste)

## Phase 2: Browser and Capture ✅

- ~~Chrome Extension with content scripts for 11 platforms (SSoT architecture)~~ ✅
- ~~Active key capture: 4-layer detection + clipboard interception~~ ✅
- ~~Automatic categorization by service provider~~ ✅
- ~~Per-platform CSS isolation + pre-hide anti-flash~~ ✅
- ~~Native Messaging Host dual-path IPC (WS primary + NMH fallback)~~ ✅
- Key vault import/export ❌

## Phase 3: System-Level

- macOS Accessibility API integration for full-screen masking
- Terminal monitoring and masking
- Multi-display support (simultaneous masking on all screens)
- OBS / screen recording compatible masking layer
- Style library expansion (100+ services)

## Future Considerations

- Windows / Linux port
- Team vault and shared key management (encrypted cloud sync)
- CI/CD integration, automated key rotation reminders
- CLI companion tool for headless environments

## Recommended Development Sequence

### Phase 1: Swift Core Skeleton
1. Create Xcode project (macOS App, SwiftUI, Menu Bar only)
2. Implement `KeychainService` — Keychain CRUD
3. Implement `VaultManager` — vault.json read/write
4. Implement `MaskingCoordinator` — pattern matching logic
5. Basic Menu Bar UI (status display + key list + Demo Mode toggle)

### Phase 2: Clipboard + Hotkeys
6. Implement `ClipboardEngine` — copy + auto-clear
7. Implement `HotkeyManager` — global hotkey registration
8. Floating Toolbox HUD (hold-to-search + Scheme B lock)

### Phase 3: IPC + VS Code Extension
9. Implement `IPCServer` — WebSocket on localhost
10. Create VS Code Extension project (TypeScript)
11. Implement pattern cache sync mechanism
12. Implement Decoration API masking rendering
13. Offline degradation mode

### Phase 4: Integration Testing
14. End-to-end test: add key → Demo Mode → VS Code masking → paste
15. Offline test: Core shutdown → Extension continues masking
16. Hotkey conflict testing

### Phase 5: Active Key Capture ✅
17. `capture-patterns.ts` Single Source of Truth architecture
18. Per-platform CSS isolation (12 separate CSS files)
19. Pre-hide anti-flash (manifest CSS → pre-hide.ts → instant MutationObserver)
20. `clipboard-patch.ts` MAIN world clipboard interception
21. React/Vue SPA masking (dialog inputs stay hidden)
22. AWS dual-key capture (Access Key ID + Secret Key)
23. Toast stacking for consecutive captures
24. E2E tested 8 platforms (GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS)
25. Developer skills (`/analyze-platform`, `/test-capture-flow`)

### Phase 6: NMH Dual-path IPC ✅
26. NativeMessagingHost.swift upgrade (get_config + WS relay)
27. IPCServer `.nmh` clientType + broadcast exclusion
28. service-worker.ts `sendRequest()` unified dispatch (WS → NMH fallback)
29. Popup connection path display (WebSocket / NMH / Offline)
30. NMHInstaller auto-install on Core startup
31. Security red line: plaintext keys not stored in chrome.storage

### Phase 7: Smart Key Extraction Confirmation Dialog ✅
32. Three-tier confidence strategy (>= 0.7 auto-store, 0.35~0.7 confirmation dialog, < 0.35 ignore)
33. Inline content script confirmation dialog (editable service name, 30s auto-dismiss, queue)
34. `confirm_captured_key` handler + `removeMaskForValue()` reject restore
35. `rejectedKeys` + `isAlreadyStoredKey()` three-layer deduplication
36. Universal Masking / Detection dual toggles (popup, default OFF)
37. Generic key pattern (confidence 0.50)
38. OpenAI pre-hide CSS fix (remove truncated preview selector)
39. GitHub Turbo navigation anti-flash (`turbo:before-render`)

## Technology Choices

| Component | Recommended Approach |
|-----------|---------------------|
| Menu Bar App | SwiftUI + AppKit (NSStatusItem) |
| Keychain | Security.framework (SecItemAdd/Copy/Update/Delete) |
| Global Hotkeys | [HotKey](https://github.com/soffes/HotKey) or CGEvent.tapCreate |
| WebSocket Server | Network.framework (NWListener) |
| VS Code Extension | TypeScript + vscode API |
| VS Code Masking | TextEditorDecorationType |
| VS Code IPC | ws (npm package) |
