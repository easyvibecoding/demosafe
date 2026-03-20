# 鍵盤快捷鍵

## 預設快捷鍵

| 動作 | 預設快捷鍵 | 設計理由 |
|------|-----------|---------|
| 切換浮動工具箱 | `⌃⌥Space` | 左手組合鍵，與應用程式衝突極少 |
| 切換展示模式 | `⌃⌥⌘D` | 三個修飾鍵防止意外觸發 |
| 直接貼上第 N 個 Key | `⌃⌥⌘[1-9]` | 已知 Key 位置的最快路徑 |
| 快速擷取剪貼簿內容 | `⌃⌥⌘V` | 貼上 + 自動解析入管理器 |

## 自訂設定

- 所有快捷鍵均可在設定中完全自訂
- **衝突偵測**：選擇的組合鍵與系統或應用程式快捷鍵重疊時即時提示警告
- HotkeyManager 使用 `CGEvent.tapCreate` 實現系統級攔截

## 技術實作

### 註冊

```swift
HotkeyManager.register(action: .toggleToolbox, modifiers: [.control, .option], keyCode: .space)
```

### 衝突偵測

```swift
HotkeyManager.detectConflicts() → [ConflictingApp]
```

回傳與已註冊快捷鍵衝突的應用程式清單。
