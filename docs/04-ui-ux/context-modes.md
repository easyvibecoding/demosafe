# 情境模式（Context Modes）

> 狀態：✅ 基本功能完成（4 個預設情境、切換、IPC 廣播）
> 尚未完成：自訂情境 UI、快捷鍵綁定

---

## 概述

情境模式是預設配置組合，控制遮蔽行為、剪貼簿策略和啟用的 Key 集合。不同場景（直播、錄影教學、內部展示、開發）需要不同的安全等級。

---

## 預設情境

| 情境 | 遮蔽等級 | 剪貼簿自動清除 | 說明 |
|------|---------|--------------|------|
| **Livestream** | `full` | 30 秒 | 最高安全：所有 Key 全遮蔽，剪貼簿快速清除 |
| **Tutorial Recording** | `full` | 10 秒 | 錄影用：全遮蔽，剪貼簿超快清除 |
| **Internal Demo** | `partial` | 無 | 內部展示：部分遮蔽，不自動清除 |
| **Development** | `off` | 無 | 開發模式：不遮蔽，方便除錯 |

---

## 遮蔽等級

| 等級 | 行為 |
|------|------|
| `full` | 所有已知 pattern 的 Key 完全遮蔽 |
| `partial` | 僅遮蔽 `activeServiceIds` 中指定的服務 |
| `off` | 不遮蔽（相當於關閉 Demo Mode） |

---

## ContextMode 結構

```swift
struct ContextMode: Codable, Identifiable {
    let id: UUID
    var name: String
    var maskingLevel: MaskingLevel      // .full, .partial, .off
    var clipboardClearSeconds: Int?     // nil = 不自動清除
    var activeServiceIds: [UUID]?       // nil = 全部服務；指定則只遮蔽這些
    var isActive: Bool
}

enum MaskingLevel: String, Codable {
    case full       // 所有 Key 全遮蔽
    case partial    // 僅指定服務
    case off        // 不遮蔽
}
```

---

## 切換流程

```
使用者選擇情境（Menu Bar → Context Mode Switcher）
    ↓
AppState.switchContext(contextId)
    ↓
VaultManager.switchContext() → 更新 isActive 標記 → 寫入 vault.json
    ↓
MaskingCoordinator.activeContext = 新情境
    ↓
MaskingCoordinator.broadcastState() → NotificationCenter
    ↓
IPCServer 收到通知 → broadcast state_changed 至所有 Extension
    ↓
VS Code Extension / Chrome Extension 更新遮蔽行為
```

---

## activeServiceIds 安全語義

`activeServiceIds` 的語義是 **allow-list**：

| 值 | 行為 |
|-----|------|
| `nil` | 所有服務的 Key 都會被遮蔽（最安全） |
| `[]`（空陣列） | 沒有任何 Key 被遮蔽（等同 off） |
| `[serviceA, serviceB]` | 僅遮蔽 serviceA 和 serviceB 的 Key |

> **安全原則**：`nil` 預設為全開遮蔽，而非全關。確保「忘記設定」不會導致安全風險。

---

## 未來擴展

| 功能 | 說明 |
|------|------|
| 自訂情境 | 使用者在 Settings 中建立自訂情境 |
| 快捷鍵綁定 | 每個情境可綁定獨立快捷鍵（如 `⌃⌥1` = Livestream） |
| 排程切換 | 根據時間自動切換情境（如日曆整合） |
| 應用程式感知 | 特定 App 啟動時自動切換（如 OBS 開啟 → Livestream） |
