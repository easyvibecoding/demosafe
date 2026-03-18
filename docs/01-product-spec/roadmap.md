# MVP 範圍與開發路線圖

## MVP 範圍（第一階段）

最小可行產品專注於 **VS Code + Menu Bar** 體驗：

- macOS Menu Bar App (Swift/SwiftUI)，Key 儲存基於 Keychain
- 展示模式切換與視覺指示
- 浮動工具箱，支援按住搜尋與方案 B 鎖定
- 鍵盤快捷鍵：`⌃⌥Space`、`⌃⌥⌘D`、`⌃⌥[1-9]`、`⌃⌥⌘V`
- VS Code Extension，使用 Decoration API 遮蔽
- 雙層 Key 階層與手動 Key 輸入
- 基本關聯 Key 群組（順序貼上）

## 第二階段：瀏覽器與擷取 ✅

- ~~Chrome Extension，支援 11 平台的 content scripts（SSoT 架構）~~ ✅
- ~~主動式 Key 截取：四層偵測 + 剪貼簿攔截~~ ✅
- ~~依服務提供者自動分類~~ ✅
- ~~Per-platform CSS 隔離 + Pre-hide 防閃現~~ ✅
- Key 保庫匯入/匯出 ❌

## 第三階段：系統級

- macOS Accessibility API 整合，實現全螢幕遮蔽
- 終端監控與遮蔽
- 多顯示器支援（所有螢幕同時遮蔽）
- OBS / 螢幕錄製相容遮蔽層
- 樣式庫擴展（100+ 服務）

## 未來考慮

- Windows / Linux 移植
- 團隊保庫與共享 Key 管理（加密雲端同步）
- CI/CD 整合，自動化 Key 輪替提醒
- CLI 配套工具，適用於無頭環境

## 建議開發順序

### Phase 1: Swift Core 骨架
1. 建立 Xcode project (macOS App, SwiftUI, Menu Bar only)
2. 實作 `KeychainService` — Keychain CRUD
3. 實作 `VaultManager` — vault.json 讀寫
4. 實作 `MaskingCoordinator` — pattern 匹配邏輯
5. 基本 Menu Bar UI（狀態顯示 + key 列表 + Demo Mode toggle）

### Phase 2: 剪貼簿 + 快捷鍵
6. 實作 `ClipboardEngine` — copy + auto-clear
7. 實作 `HotkeyManager` — 全域快捷鍵註冊
8. 浮動工具箱 HUD（hold-to-search + Scheme B 鎖定）

### Phase 3: IPC + VS Code Extension
9. 實作 `IPCServer` — WebSocket on localhost
10. 建立 VS Code Extension 專案 (TypeScript)
11. 實作 pattern cache 同步機制
12. 實作 Decoration API 遮蔽渲染
13. 離線降級模式

### Phase 4: 整合測試
14. 端到端測試：新增 key → Demo Mode → VS Code 遮蔽 → 貼上
15. 離線測試：Core 關閉 → Extension 持續遮蔽
16. 快捷鍵衝突測試

### Phase 5: Active Key Capture ✅
17. `capture-patterns.ts` Single Source of Truth 架構
18. Per-platform CSS isolation（12 個平台獨立 CSS）
19. Pre-hide anti-flash（manifest CSS → pre-hide.ts → instant MutationObserver）
20. `clipboard-patch.ts` MAIN world 剪貼簿攔截
21. React/Vue SPA masking（dialog input 保持隱藏）
22. AWS 雙金鑰截取（Access Key ID + Secret Key）
23. Toast 堆疊顯示
24. E2E 測試 8 平台（GitHub, HuggingFace, GitLab, OpenAI, Anthropic, AI Studio, Google Cloud, AWS）
25. Developer skills（`/analyze-platform`, `/test-capture-flow`）

## 技術選型

| 元件 | 建議方案 |
|------|---------|
| Menu Bar App | SwiftUI + AppKit (NSStatusItem) |
| Keychain | Security.framework (SecItemAdd/Copy/Update/Delete) |
| 全域快捷鍵 | [HotKey](https://github.com/soffes/HotKey) 或 CGEvent.tapCreate |
| WebSocket Server | Network.framework (NWListener) |
| VS Code Extension | TypeScript + vscode API |
| VS Code 遮蔽 | TextEditorDecorationType |
| VS Code IPC | ws (npm package) |
