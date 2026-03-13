# VS Code Extension 架構

> 狀態：✅ 核心功能完成（IPC 連線、Editor Decoration、Status Bar）
> 未來目標：Terminal masking（node-pty + Pseudoterminal）

---

## 系統架構

```
┌──────────────────────────────────────────────┐
│               VS Code Extension               │
│                                                │
│  ┌──────────────┐  ┌────────────────────────┐ │
│  │ IPCClient    │  │ DecorationManager      │ │
│  │ (WebSocket)  │→ │ (TextEditorDecoration)  │ │
│  └──────┬───────┘  └────────────────────────┘ │
│         │           ┌────────────────────────┐ │
│         │           │ StatusBarManager       │ │
│         │           │ (StatusBarItem)        │ │
│         │           └────────────────────────┘ │
│         │           ┌────────────────────────┐ │
│         │           │ PatternCache           │ │
│         │           │ (JSON file cache)      │ │
│         │           └────────────────────────┘ │
└─────────┼──────────────────────────────────────┘
          │ WebSocket ws://127.0.0.1:{port}
          ↓
┌──────────────────┐
│ Swift Core       │
│ IPCServer        │
└──────────────────┘
```

---

## 元件說明

### IPCClient (`ipc-client.ts`)

**職責**：
- 讀取 `~/.demosafe/ipc.json` 取得連線資訊
- 建立 WebSocket 連線至 Core（使用 `ws` npm 套件）
- 發送 handshake（clientType: 'vscode'）
- 接收並派發事件（stateChanged、patternsUpdated、clipboardCleared）
- 指數退避重連（1s → 2s → 4s → 最大 30s + jitter）

**事件**：
| 事件 | 說明 |
|------|------|
| `connected` | handshake 成功 |
| `disconnected` | 連線中斷 |
| `stateChanged` | Demo Mode 或 Context 變更 |
| `patternsUpdated` | Pattern cache 更新 |
| `clipboardCleared` | 剪貼簿已清除 |
| `log` | 內部 log 轉發至 OutputChannel |

### DecorationManager (`decoration-manager.ts`)

**遮蔽策略**：

原始文字透過 `opacity: '0'` + `letterSpacing: '-1em'` 隱藏（視覺上寬度為零），
遮蔽文字透過 `after` pseudo-element 顯示，並 pad 至原始 key 長度以避免排版偏移。

```
原始：sk-proj-abcdefghijklmnopqrstuvwxyz1234567890
顯示：sk-****************************...********
      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 與原始等寬
```

**核心邏輯**：
1. 文件開啟 / 變更時，以所有 cached patterns 掃描內容
2. isDemoMode 為 true 時套用 decoration
3. isDemoMode 為 false 時清除所有 decoration
4. 每個不同的 maskedText 建立獨立的 `TextEditorDecorationType`（Map-based）

**padMaskedText 演算法**：
```typescript
function padMaskedText(masked: string, targetLen: number): string {
    if (masked.length >= targetLen) return masked;
    const padCount = targetLen - masked.length;
    const midpoint = Math.floor(masked.length / 2);
    return masked.slice(0, midpoint) + '*'.repeat(padCount) + masked.slice(midpoint);
}
```

### PatternCache (`pattern-cache.ts`)

**職責**：
- 將從 Core 收到的 pattern 持久化至 `globalStoragePath/pattern-cache.json`
- Core 離線時提供 cached patterns 繼續遮蔽
- 追蹤 `patternCacheVersion` 判斷是否需要同步

### StatusBarManager (`status-bar.ts`)

**狀態顯示**：
| 狀態 | 顯示 |
|------|------|
| Connected + Demo OFF | `$(shield) Demo-safe` |
| Connected + Demo ON | `$(shield) Demo-safe 🔴 DEMO` |
| Offline (有 cache) | `$(shield) Demo-safe ⚠️ Offline` |
| Offline (無 cache) | `$(shield) Demo-safe ❌ No Cache` |

---

## 離線降級

| 場景 | 行為 |
|------|------|
| Core 關閉 | 使用 cached patterns 繼續遮蔽；Status bar 顯示 Offline |
| 首次安裝（無 cache） | 無法遮蔽；Status bar 顯示 No Cache |
| Core 重啟 | 自動重連（讀取新的 ipc.json）；重新同步 patterns |

---

## 指令

| Command ID | 標題 | 說明 |
|-----------|------|------|
| `demosafe.toggleDemoMode` | Toggle Demo Mode | 切換展示/一般模式 |
| `demosafe.pasteKey` | Paste Key | 開啟 Key 選單貼上 |

---

## 未來：Terminal Masking

見 `files_demo/` 參考實作和 [07-known-issues-and-improvements.md](../07-known-issues-and-improvements.md)。

**架構**：Proxy Terminal（node-pty + Pseudoterminal）
```
VS Code Terminal（使用者看到的，已過濾）
    ↑ writeEmitter.fire(filtered)
代理層（maskSecrets 正則過濾）
    ↑ ptyProcess.onData(raw)
node-pty（真實 shell 程序）
```
