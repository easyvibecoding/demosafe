# 實作狀態追蹤

> 最後更新：2026-03-18

## 狀態圖例

- ✅ 已完成
- 🔶 部分完成
- ❌ 尚未開始
- 🔮 未來目標

---

## Swift Core Engine

| 模組 | 狀態 | 備註 |
|------|------|------|
| VaultManager (CRUD, vault.json) | ✅ | Service / KeyEntry / ContextMode CRUD 完成 |
| KeychainService | ✅ | store / retrieve / delete 完成 |
| ClipboardEngine | ✅ | copy + autoClear + detectKeys 完成 |
| MaskingCoordinator | ✅ | isDemoMode / activeContext / pattern 匹配完成 |
| IPCServer (WebSocket) | ✅ | handshake / state_changed / pattern_cache_sync / toggle_demo_mode / nmh clientType |
| HotkeyManager | ✅ | `⌃⌥⌘D` toggle、`⌃⌥Space` hold 偵測、`⌃⌥[1-9]` paste、flagsChanged 監聽 |
| Floating Toolbox (HUD) | ✅ | NSPanel 浮動視窗、hold-to-search、Scheme B 鎖定、↑↓ 導航 |
| ToolboxState (ViewModel) | ✅ | 搜尋過濾、選取狀態、release/confirm/dismiss 邏輯 |
| FloatingToolboxController | ✅ | NSPanel 管理、游標定位、鎖定模式 makeKey |
| Menu Bar App | ✅ | 原生選單樣式、Demo Mode toggle、Settings 視窗 |
| SettingsWindowController | ✅ | 獨立 NSWindow，從 menu bar app 正常開啟 |
| Settings UI | 🔶 | 基本 Tab 框架，Key 管理 + Add Service 完成 |

### 尚未實作的 Core 功能

| 功能 | 對應 Spec 章節 | 優先順序 | 備註 |
|------|--------------|---------|---------|
| `⌃⌥⌘V` capture clipboard | Spec §4.4 | 中 | HotkeyManager 端尚未掛載 ClipboardEngine.detectKeys |
| Linked Key Groups (sequential paste) | Spec §6.3 | 中 | `LinkedGroup`/`GroupEntry` 結構未建立 |
| Shortcut conflict detection | Spec §4.4 | 低 | |
| Import / Export vault | Spec §9.1 | 低 | |

> **注意**：Smart Key Extraction 的 Chrome ↔ Core IPC 溝通已完整實作（`submit_captured_key` → `handleSubmitCapturedKey` → VaultManager + Keychain → `pattern_cache_sync`）。上方僅列出真正尚未實作的獨立功能。

---

## VS Code Extension

| 功能 | 狀態 | 備註 |
|------|------|------|
| IPC WebSocket 連線 | ✅ | exponential backoff reconnect |
| Pattern cache 同步 | ✅ | 離線仍用 cached patterns |
| Editor Decoration masking | ✅ | `letterSpacing: '-1em'` + padded masked text |
| Status bar 狀態顯示 | ✅ | Connected / Offline / No Cache |
| Demo Mode toggle 指令 | ✅ | Command palette + IPC |
| Paste key 指令 | ✅ | 透過 IPC request_paste |
| Terminal masking (node-pty) | 🔮 | 參考 `files_demo/`；見 memory |

### 已修復的問題

- Decoration 文字擠壓：原文隱藏用 `opacity: '0'` + `letterSpacing: '-1em'`，遮蔽文字 pad 至原始長度
- Gutter icon 不存在：已移除引用

### 已知注意事項

- **Keychain ACL**：透過 `security` CLI 手動加入的 Keychain 項目，DemoSafe app 讀取時會跳出系統授權提示。必須透過 `SecItemAdd` API（即 `KeychainService.storeKey` 或同等 Swift 程式碼）加入，ACL 才會自動授權 DemoSafe 存取。

---

## Chrome Extension

| 功能 | 狀態 | 備註 |
|------|------|------|
| Background Service Worker | ✅ | WebSocket 連線、NMH fallback 雙路分派、state 管理、reconnect |
| Popup UI | ✅ | 連線狀態（WebSocket/NMH/Offline）、Demo Mode、Context、Patterns |
| Toggle Demo Mode | ✅ | Popup → Background → Core → broadcast |
| Content Script DOM masking | ✅ | TreeWalker + CSS overlay + MutationObserver |
| Content Script unmask | ✅ | 退出 Demo Mode 恢復原始文字 |
| Options 頁面 | ✅ | Pattern cache 管理 + Dev IPC Config |
| Dev IPC Config (workaround) | ✅ | 替代 Native Messaging Host |
| Native Messaging Host | ✅ | get_config + WS relay（get_state / submit_captured_key / toggle_demo_mode） |
| NMH 雙路 IPC | ✅ | WS primary + NMH fallback，popup 顯示連線路徑 |
| NMHInstaller（Core 自動安裝） | ✅ | Core 啟動時從 bundle Resources 安裝 binary + manifest |
| Active Key Capture | ✅ | 4 層偵測：DOM scan → attribute → clipboard → platform selectors |
| capture-patterns.ts (SSoT) | ✅ | 11 平台 pattern 定義，單一檔案維護 |
| Pre-hide anti-flash | ✅ | 三層：manifest CSS → pre-hide.ts → instant MutationObserver |
| Per-platform CSS isolation | ✅ | 12 個獨立 CSS 檔，build time 生成 |
| Clipboard writeText interception | ✅ | `clipboard-patch.ts` MAIN world，支援 AI Studio/AWS/Stripe |
| React SPA masking | ✅ | Dialog input 保持隱藏，不替換 value |
| AWS dual-key capture | ✅ | Access Key ID (DOM) + Secret Key (clipboard) |
| Toast stacking | ✅ | 連續 capture 堆疊顯示 |
| Smart Key Extraction 確認對話框 | ✅ | 三區間信心度策略 + 確認 UI + reject 恢復 |
| Universal Masking / Detection | ✅ | Popup 雙開關，擴展非已知平台 |
| Generic key pattern | ✅ | 通用 prefix 偵測（confidence 0.50） |
| Turbo 導航防閃現 | ✅ | turbo:before-render pre-hide |
| Capture Mode (popup) | ✅ | Start/Stop capture + countdown timer |
| E2E 測試 (8 平台) | ✅ | GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS |
| Stripe / Slack / SendGrid | 🔶 | Pattern 已定義，未測試 |

### 已修復的問題

- Content script 初始狀態不同步：載入時主動向 background 請求 `get_state`
- `toggle_demo_mode` action 錯誤發送 `get_state`：已修正
- GitLab 2026 改版：selectors 從 `#created-personal-access-token` 更新為 `.gl-alert-success`
- OpenAI React SPA：`input.value` 被框架覆蓋導致明文暴露，改用 CSS 隱藏
- AWS Secret Key `trimmed` 變數未定義：修正為 `text.trim()`
- preHideCSS 過廣：OpenAI `input[type="text"]` 隱藏了 Name input，已縮窄

---

## CI/CD

| 項目 | 狀態 |
|------|------|
| ESLint (VS Code Extension) | ✅ |
| ESLint (Chrome Extension) | ✅ |
| Build (all workspaces) | ✅ |

---

## 開發順序對照

根據 Spec §9 路線圖：

### Phase 1: Swift Core 骨架 ✅
1. ~~建立專案~~ ✅
2. ~~KeychainService~~ ✅
3. ~~VaultManager~~ ✅
4. ~~MaskingCoordinator~~ ✅
5. ~~Menu Bar UI~~ ✅

### Phase 2: 剪貼簿 + 快捷鍵 ✅
6. ~~ClipboardEngine~~ ✅
7. ~~HotkeyManager（hold 偵測 + flagsChanged + 字元轉發）~~ ✅
8. ~~Floating Toolbox HUD（NSPanel + hold-to-search + Scheme B 鎖定 + `⌃⌥[1-9]` paste）~~ ✅

### Phase 3: IPC + VS Code Extension ✅
9. ~~IPCServer~~ ✅
10. ~~VS Code Extension 專案~~ ✅
11. ~~Pattern cache 同步~~ ✅
12. ~~Decoration API 遮蔽~~ ✅
13. ~~離線降級~~ ✅

### Phase 4: 整合測試 ✅
14. ~~端到端測試~~ ✅ (手動)
15. 離線測試 🔶 (未正式驗證)
16. 快捷鍵衝突測試 ❌

### 超前進度：Chrome Extension ✅
- ~~WebSocket 連線~~ ✅
- ~~Content Script masking~~ ✅
- ~~Toggle Demo Mode~~ ✅

### Phase 5: Active Key Capture ✅
- ~~capture-patterns.ts SSoT~~ ✅
- ~~Per-platform CSS isolation~~ ✅
- ~~Pre-hide anti-flash (3 層)~~ ✅
- ~~Clipboard writeText interception~~ ✅
- ~~React SPA masking~~ ✅
- ~~AWS dual-key capture~~ ✅
- ~~Toast stacking~~ ✅
- ~~E2E 測試 8 平台~~ ✅
- Stripe / Slack / SendGrid 🔶

### Phase 6: 跨平台支援 🔮

三層分離架構使 Extension 層（VS Code + Chrome）完全復用，僅需重寫 System Layer：

```
[VS Code Extension] ── IPC ──┐
                             │
[Chrome Extension] ── IPC ───┤── [System Layer]
                             │
System Layer = SecretStore + Demo Mode + IPC
  ├─ macOS: Keychain + SwiftUI          ← 現有
  ├─ Windows: Credential Manager + WinUI/WPF
  └─ Ubuntu: libsecret + GTK/Qt
```

| 組件 | macOS (現有) | Windows | Ubuntu |
|------|-------------|---------|--------|
| Secret Store | Keychain | Credential Manager (DPAPI) | libsecret (GNOME Keyring) |
| IPC Server | NWListener WebSocket | .NET/Rust WebSocket | Rust WebSocket |
| NMH Binary | Swift CLI | .exe (C#/Rust) | ELF (Rust) |
| System Tray | MenuBarExtra (SwiftUI) | WinUI NotifyIcon | GTK StatusIcon |
| Hotkey | CGEvent + HotkeyManager | RegisterHotKey API | X11 XGrabKey |
| Clipboard | NSPasteboard | Win32 Clipboard API | xclip / wl-clipboard |

**不需修改的部分**：Chrome Extension、VS Code Extension、shared/ipc-protocol、capture-patterns.ts

**建議策略**：System Layer 用 Rust 統一實作（跨平台編譯），GUI 薄殼用各平台原生方案。
