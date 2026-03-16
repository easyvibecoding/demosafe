# Demo-safe API Key Manager — 文件索引

本目錄將原始 `.docx` 規格文件拆分為可搜尋、可版控的 Markdown，方便開發時快速查閱。

## 目錄結構

| 目錄 | 內容 |
|------|------|
| `01-product-spec/` | 產品概述、目標使用者、使用情境、MVP 範圍與路線圖、**實作狀態追蹤** |
| `02-technical-architecture/` | 系統架構、資料模型、Swift Core 六大模組、**VS Code Extension 架構**、**Chrome Extension 架構**、模組依賴 |
| `03-security/` | 安全紅線、儲存策略、剪貼簿安全、IPC 安全規則 |
| `04-ui-ux/` | 狀態機、Menu Bar App、浮動工具箱、快捷鍵、設定頁、**情境模式**、**智慧 Key 擷取** |
| `05-ipc-protocol/` | 連線機制、訊息格式、Request/Event Actions、Pattern Cache 同步 |
| `06-pattern-reference/` | 內建 regex 樣式庫、遮蔽格式規則、自訂樣式指引 |
| `07-known-issues-and-improvements.md` | 已知問題與待改進項目 |
| `08-terminal-masking-research.md` | Terminal Masking 技術研究（node-pty vs ANSI fg=bg vs 混合方案） |
| `09-api-key-rotation-best-practices.md` | 各平台 API Key 部署與輪替最佳實踐、零停機輪替模式 |
| `10-active-key-capture.md` | 主動式 API Key 網頁截取（Chrome Extension 自動偵測擷取） |
| `11-platform-specific-capture-strategies.md` | 各平台 API Key 截取策略（DOM 結構、選擇器、實作計畫） |

## 來源文件對照

| 原始文件 | 對應章節 |
|---------|---------|
| `Demo-safe_API_Key_Manager_Spec.docx` | 01, 04, 06 |
| `Demo-safe_API_Key_Manager_Technical_Architecture.docx` | 02, 03, 05 |

## 快速參考

| 我要... | 看這份文件 |
|---------|-----------|
| 了解目前完成了什麼 | [implementation-status.md](01-product-spec/implementation-status.md) |
| 了解下一步要做什麼 | [roadmap.md](01-product-spec/roadmap.md) + [implementation-status.md](01-product-spec/implementation-status.md) |
| 了解安全紅線 | [security-rules.md](03-security/security-rules.md) |
| 了解 IPC 訊息格式 | [protocol-spec.md](05-ipc-protocol/protocol-spec.md) |
| 了解 Pattern regex | [masking-format.md](06-pattern-reference/masking-format.md) |
| 了解已知 bug | [07-known-issues-and-improvements.md](07-known-issues-and-improvements.md) |
| 了解 Chrome Extension 架構 | [chrome-extension-architecture.md](02-technical-architecture/chrome-extension-architecture.md) |
| 了解 VS Code Extension 架構 | [vscode-extension-architecture.md](02-technical-architecture/vscode-extension-architecture.md) |
| 了解 Terminal Masking 方案 | [08-terminal-masking-research.md](08-terminal-masking-research.md) |

> 所有文件以繁體中文撰寫，技術名詞保留英文原文。
