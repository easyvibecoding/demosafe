# Known Issues & Improvements

## Chrome Extension

### ~~Native Messaging Host 尚未安裝~~ ✅ 已解決
- `NMHInstaller` 已實作：Core 啟動時自動從 app bundle Resources 安裝 binary + Chrome manifest
- binary 安裝至 `/Applications/DemoSafe.app/Contents/Helpers/demosafe-nmh`
- manifest 安裝至 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json`
- Extension ID 由 NMH 啟動時從 `chrome.runtime` 自動取得，無需手動替換
- **Workaround 仍保留**：Options 頁面的 Dev IPC Config 可用於開發測試

### Content Script Pattern 匹配精度
- Vault 中的 pattern `sk-[a-zA-Z0-9]+` 不包含 `-` 字元
- 導致 `sk-ant-api03-xxx` 只匹配到 `sk-ant` 就停止，剩餘部分暴露
- **改進方向**: 內建 service 的 defaultPattern 需要更精確，例如：
  - Anthropic: `sk-ant-api03-[a-zA-Z0-9_-]+`
  - OpenAI: `sk-proj-[a-zA-Z0-9]+`
  - 或使用更寬鬆的通配: `sk-[a-zA-Z0-9_-]+`

### Manifest 權限範圍
- 開發測試時加入了 `<all_urls>` 和 `http://localhost/*`
- 正式版應移除，只保留目標 API console 網站

### Content Script 初始狀態同步
- 已修復：content script 載入時主動向 background 請求當前 demo mode 狀態
- 之前的問題：頁面載入時 `isDemoMode` 預設為 `false`，需等 `state_changed` 事件

## VS Code Extension

### Terminal Masking（未來目標）
- 目前只有 Editor Decoration masking
- 需要支援終端輸出中的 API key 遮蔽（如 Claude Code 的 terminal 輸出）
- 參考實作: `files_demo/` 目錄（Secret Shield v2）
- 詳細技術方案比較見 [08-terminal-masking-research.md](08-terminal-masking-research.md)

### Decoration 文字對齊
- 已修復：使用 `letterSpacing: '-1em'` + padded masked text
- 監控：複雜排版場景下可能仍有邊界情況

## Swift Core

### AppState.isDemoMode 雙向同步
- 已透過 Combine `$isDemoMode` assign 實現
- IPCServer 的 `handleToggleDemoMode` 直接修改 `MaskingCoordinator.isDemoMode`
- MaskingCoordinator 變更會自動同步回 AppState

### Debug Log 清理
- `AppState.swift` 和 `ipc-client.ts` 中有開發用的 print/console.log
- 正式版前應清理或改用 proper logging framework
