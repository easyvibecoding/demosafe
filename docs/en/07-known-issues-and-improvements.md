# Known Issues & Improvements

## Chrome Extension

### ~~Native Messaging Host Not Yet Installed~~ ✅ Resolved
- `NMHInstaller` implemented: Core auto-installs binary + Chrome manifest from app bundle Resources on startup
- Binary installed to `/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh`
- Manifest installed to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json`
- Extension ID obtained automatically by NMH at runtime via `chrome.runtime`; no manual replacement needed
- **Workaround retained**: Dev IPC Config on Options page remains available for development testing

### Content Script Pattern Matching Precision
- The pattern `sk-[a-zA-Z0-9]+` in Vault does not include the `-` character
- This causes `sk-ant-api03-xxx` to only match up to `sk-ant`, exposing the remaining portion
- **Improvement direction**: Built-in service defaultPatterns need to be more precise, for example:
  - Anthropic: `sk-ant-api03-[a-zA-Z0-9_-]+`
  - OpenAI: `sk-proj-[a-zA-Z0-9]+`
  - Or use a more permissive wildcard: `sk-[a-zA-Z0-9_-]+`

### Manifest Permission Scope
- `<all_urls>` and `http://localhost/*` were added during development testing
- Should be removed for production, keeping only target API console websites

### Content Script Initial State Sync
- Fixed: content script now actively requests current demo mode state from background on load
- Previous issue: `isDemoMode` defaulted to `false` on page load, requiring a `state_changed` event

## VS Code Extension

### Terminal Masking (Future Goal)
- Currently only Editor Decoration masking is available
- Need to support API key masking in terminal output (e.g., Claude Code terminal output)
- Reference implementation: `files_demo/` directory (Secret Shield v2)
- Detailed technical approach comparison in [08-terminal-masking-research.md](08-terminal-masking-research.md)

### Decoration Text Alignment
- Fixed: using `letterSpacing: '-1em'` + padded masked text
- Monitor: edge cases may still exist in complex layout scenarios

## Swift Core

### AppState.isDemoMode Bidirectional Sync
- Implemented via Combine `$isDemoMode` assign
- IPCServer's `handleToggleDemoMode` directly modifies `MaskingCoordinator.isDemoMode`
- MaskingCoordinator changes automatically sync back to AppState

### Debug Log Cleanup
- `AppState.swift` and `ipc-client.ts` contain development print/console.log statements
- Should be cleaned up or replaced with a proper logging framework before release
