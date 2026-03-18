# Demo-safe API Key Manager

[English](README.md) | **繁體中文**

**讓 API Key 在展示、直播和教學中徹底隱形。**

Demo-safe 是一款 macOS 系統級工具，從 API Key 進入工作流程的那一刻起就自動遮蔽。如同 macOS 鑰匙圈，金鑰永遠不會以明文顯示在螢幕上——但透過複製貼上仍然完全可用。

螢幕顯示 `sk-proj-****...****`，剪貼簿裡是完整的金鑰。

## 功能特色

- **Menu Bar App**（Swift/SwiftUI）— 中央控制台，Demo Mode 切換、金鑰庫、情境模式
- **VS Code Extension** — 編輯器行內遮蔽，透過 Decoration API 即時 pattern 匹配
- **Chrome Extension** — API 管理頁面 DOM 層級遮蔽（OpenAI、Anthropic、AWS、Stripe 等）
- **Keychain 加密儲存** — 金鑰靜態加密，永不以明文儲存
- **情境模式** — 針對不同場景的預設配置（直播、錄影教學、內部展示、開發）
- **WebSocket IPC** — 所有元件透過 localhost 即時同步狀態

## 系統架構

```
[VS Code Extension] <-> [核心引擎 (Swift)] <-> [Chrome Extension]
                              |
                      [macOS Keychain]
```

- **核心引擎**：Swift Menu Bar App — 金鑰庫管理、Keychain 整合、快捷鍵處理、WebSocket IPC 伺服器
- **IDE 層**：VS Code Extension — 文件層級 pattern 匹配與行內遮蔽
- **瀏覽器層**：Chrome Extension — 網頁 API 管理頁面 DOM 遮蔽
- **系統層**：macOS Accessibility API（規劃中，Phase 3）

## 系統需求

- macOS 14+（Sonoma 或更新版本）
- Xcode 15+ 或 Swift 5.9+ 工具鏈
- Node.js 18+
- Chrome 88+（Chrome Extension）
- VS Code 1.85+（VS Code Extension）

## 快速開始

### 1. 複製並安裝依賴

```bash
git clone https://github.com/easyvibecoding/SafeApiKeyManager.git
cd SafeApiKeyManager
npm install
```

### 2. 建置 Swift Core

```bash
cd packages/swift-core
swift build
# 執行 Menu Bar App
.build/arm64-apple-macosx/debug/DemoSafe
```

### 3. 建置 VS Code Extension

```bash
npm run build:vscode
```

在 VS Code 中：按 F5 執行 Extension，或安裝 `.vsix` 套件。

### 4. 建置 Chrome Extension

```bash
npm run build:chrome
```

在 Chrome 中：
1. 前往 `chrome://extensions`
2. 開啟「開發人員模式」
3. 點擊「載入未封裝項目」，選擇 `packages/chrome-extension/`

### 5. 連接 Extension 與 Core

Swift Core 啟動時會寫入 `~/.demosafe/ipc.json`，包含 WebSocket port 和認證 token。Extension 讀取此檔案自動連線。

## 專案結構

```
SafeApiKeyManager/
├── packages/
│   ├── swift-core/          # macOS Menu Bar App (Swift/SwiftUI)
│   ├── vscode-extension/    # VS Code Extension (TypeScript)
│   └── chrome-extension/    # Chrome Extension (Manifest V3)
├── shared/
│   └── ipc-protocol/        # 共用 IPC 型別定義
├── docs/                    # 架構文件、規格、狀態追蹤
├── files_demo/              # Terminal masking 參考實作
└── package.json             # npm workspaces 根目錄
```

## 開發

### 全部建置

```bash
npm run build:all    # 建置 shared + VS Code + Chrome extensions
npm run lint         # Lint 所有 TypeScript workspaces
npm run type-check   # 型別檢查所有 TypeScript workspaces
```

### Swift Core

```bash
cd packages/swift-core
swift build            # Debug 建置
swift build -c release # Release 建置
swift test             # 執行測試
```

## 運作方式

1. **新增金鑰** — 透過 Menu Bar App 加入金鑰庫（儲存於 macOS Keychain，靜態加密）
2. **切換 Demo Mode** — Menu Bar 按鈕或鍵盤快捷鍵
3. **金鑰自動遮蔽** — VS Code 編輯器和 Chrome 瀏覽器頁面透過 regex pattern 匹配即時遮蔽
4. **複製金鑰** — 透過 Menu Bar 複製，剪貼簿持有真實金鑰，螢幕只顯示 `sk-****...****`
5. **自動清除剪貼簿** — 依情境模式設定的逾時時間自動清除

### 安全原則

- **明文永不經過 IPC** — 只傳輸遮蔽表示和金鑰參照
- **WebSocket 僅綁定 localhost**（127.0.0.1）— 無法從外部連入
- **Handshake Token 認證** — 每次 Core 重啟時重新產生
- **ipc.json 權限** — 設為 600（僅使用者可讀寫）
- **Keychain 存取** — `kSecAttrAccessible: whenUnlockedThisDeviceOnly`

## 文件

詳細規格請見 [docs/](docs/) 目錄：

| 文件 | 說明 |
|------|------|
| [實作狀態](docs/01-product-spec/implementation-status.md) | 已完成與規劃中的功能 |
| [產品規格](docs/01-product-spec/overview.md) | 問題描述、目標使用者、使用情境 |
| [技術架構](docs/02-technical-architecture/swift-core-modules.md) | 核心模組、資料模型、依賴關係 |
| [安全規則](docs/03-security/security-rules.md) | 安全紅線 |
| [IPC 協議](docs/05-ipc-protocol/protocol-spec.md) | WebSocket 訊息格式與 Actions |
| [Pattern 參考](docs/06-pattern-reference/masking-format.md) | 內建 regex 庫、遮蔽格式 |

## 開發路線圖

- [x] Swift Core Engine（Vault、Keychain、Clipboard、IPC、Masking）
- [x] VS Code Extension（Editor Decoration 遮蔽）
- [x] Chrome Extension（DOM 遮蔽、WebSocket IPC）
- [x] 浮動工具箱 HUD（按住搜尋 + Scheme B 鎖定）
- [x] 快捷鍵貼上（Ctrl+Option+[1-9]）
- [x] 主動式 Key 截取（網頁自動偵測擷取，四層掃描）
- [x] 各平台專屬截取策略（8 平台 E2E 測試通過，SSoT 架構）
- [x] Per-platform CSS 隔離 + clipboard writeText 攔截
- [x] Native Messaging Host 雙路 IPC（WS primary + NMH fallback）
- [x] 智慧 Key 擷取確認對話框（完整 Chrome ↔ Swift Core IPC：偵測 → submit → Keychain 儲存 → pattern 廣播）
- [ ] 關聯 Key 群組（順序貼上）
- [ ] API Key 輪替與部署同步
- [ ] Terminal 遮蔽（node-pty proxy）
- [ ] 系統級遮蔽（Accessibility API）

## 貢獻

歡迎貢獻！請參閱 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

## 授權

[Apache License 2.0](LICENSE)
