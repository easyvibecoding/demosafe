# Demo-safe API Key Manager

**English** | [繁體中文](README.zh-TW.md)

**Make API keys invisible during demos, livestreams, and tutorials.**

Demo-safe is a macOS system-level tool that masks API keys from the moment they enter your workflow. Like macOS Keychain, keys are never displayed in plaintext on any screen — yet they remain fully functional via copy-paste.

Screen shows `sk-proj-****...****` but clipboard holds the complete key.

## Features

- **Menu Bar App** (Swift/SwiftUI) — Central command center with Demo Mode toggle, key library, and context modes
- **VS Code Extension** — Inline editor masking via Decoration API with real-time pattern matching
- **Chrome Extension** — DOM-level masking on API console pages (OpenAI, Anthropic, AWS, Stripe, etc.)
- **Keychain-backed storage** — Keys encrypted at rest, never stored in plaintext
- **Context Modes** — Preset configurations for different scenarios (Livestream, Tutorial, Internal Demo, Development)
- **IPC via WebSocket** — Real-time state sync between all components over localhost

## Architecture

```
[VS Code Extension] <-> [Core Engine (Swift)] <-> [Chrome Extension]
                              |
                      [macOS Keychain]
```

- **Core Engine**: Swift Menu Bar App — vault management, Keychain integration, hotkey handling, WebSocket IPC server
- **IDE Layer**: VS Code Extension — document-level pattern matching with inline masking
- **Browser Layer**: Chrome Extension — DOM masking for web-based API dashboards
- **System Layer**: macOS Accessibility API (planned Phase 3)

## Prerequisites

- macOS 14+ (Sonoma or later)
- Xcode 15+ or Swift 5.9+ toolchain
- Node.js 18+
- Chrome 88+ (for Chrome Extension)
- VS Code 1.85+ (for VS Code Extension)

## Quick Start

### 1. Clone and install dependencies

```bash
git clone https://github.com/easyvibecoding/SafeApiKeyManager.git
cd SafeApiKeyManager
npm install
```

### 2. Build Swift Core

```bash
cd packages/swift-core
swift build
# Run the menu bar app
.build/arm64-apple-macosx/debug/DemoSafe
```

### 3. Build VS Code Extension

```bash
npm run build:vscode
```

Then in VS Code: Run Extension (F5) or install the `.vsix` package.

### 4. Build Chrome Extension

```bash
npm run build:chrome
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select `packages/chrome-extension/`

### 5. Connect extensions to Core

The Swift Core writes `~/.demosafe/ipc.json` on startup with the WebSocket port and auth token. Extensions read this file to connect automatically.

## Project Structure

```
SafeApiKeyManager/
├── packages/
│   ├── swift-core/          # macOS Menu Bar App (Swift/SwiftUI)
│   ├── vscode-extension/    # VS Code Extension (TypeScript)
│   └── chrome-extension/    # Chrome Extension (Manifest V3)
├── shared/
│   └── ipc-protocol/        # Shared IPC type definitions
├── docs/                    # Architecture docs, specs, status tracking
├── files_demo/              # Reference implementation for terminal masking
└── package.json             # npm workspaces root
```

## Development

### Build all

```bash
npm run build:all    # Build shared + VS Code + Chrome extensions
npm run lint         # Lint all TypeScript workspaces
npm run type-check   # Type check all TypeScript workspaces
```

### Swift Core

```bash
cd packages/swift-core
swift build            # Debug build
swift build -c release # Release build
swift test             # Run tests
```

## How It Works

1. **Add keys** to the vault via the Menu Bar App (stored in macOS Keychain, encrypted at rest)
2. **Toggle Demo Mode** with the menu bar toggle or keyboard shortcut
3. **Keys are masked** in VS Code editors and Chrome browser pages using regex pattern matching
4. **Copy keys** via the menu bar — clipboard holds the real key, but screen shows `sk-****...****`
5. **Auto-clear clipboard** after configurable timeout per context mode

### Security Principles

- **Plaintext never travels over IPC** — only masked representations and key references
- **WebSocket binds to localhost only** (127.0.0.1) — no remote connections
- **Handshake token authentication** — refreshed on every Core restart
- **ipc.json permissions** — set to 600 (user read/write only)
- **Keychain access** — `kSecAttrAccessible: whenUnlockedThisDeviceOnly`

## Documentation

See the [docs/](docs/) directory for detailed specifications:

| Document | Description |
|----------|-------------|
| [Implementation Status](docs/01-product-spec/implementation-status.md) | What's done, what's planned |
| [Product Spec](docs/01-product-spec/overview.md) | Problem statement, target users, use cases |
| [Technical Architecture](docs/02-technical-architecture/swift-core-modules.md) | Core modules, data model, dependencies |
| [Security Rules](docs/03-security/security-rules.md) | Hard security boundaries |
| [IPC Protocol](docs/05-ipc-protocol/protocol-spec.md) | WebSocket message format and actions |
| [Pattern Reference](docs/06-pattern-reference/masking-format.md) | Built-in regex library, masking formats |

## Roadmap

- [x] Swift Core Engine (Vault, Keychain, Clipboard, IPC, Masking)
- [x] VS Code Extension (Editor Decoration masking)
- [x] Chrome Extension (DOM masking, WebSocket IPC)
- [x] Floating Toolbox HUD (hold-to-search + Scheme B lock)
- [x] Keyboard shortcut paste (Ctrl+Option+[1-9])
- [x] Active Key Capture (auto-detect keys from web pages)
- [x] Platform-specific capture strategies (8 platforms tested, SSoT architecture)
- [x] Per-platform CSS isolation + clipboard writeText interception
- [x] Native Messaging Host dual-path IPC (WS primary + NMH fallback)
- [x] Smart Key Extraction confirmation dialog (full Chrome ↔ Swift Core IPC: detect → submit → Keychain store → pattern sync)
- [ ] Linked Key Groups (sequential paste)
- [ ] API Key rotation & deployment sync
- [ ] Terminal masking (node-pty proxy)
- [ ] System-wide masking (Accessibility API)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache License 2.0](LICENSE)
