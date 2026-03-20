# Swift Core 模組

## 模組總覽

核心引擎由六大模組組成，由 `DemoSafeApp` 統籌協調：

```
DemoSafeApp (SwiftUI)
├── VaultManager          // vault.json CRUD
├── KeychainService       // 明文唯一接觸點
├── ClipboardEngine       // NSPasteboard 唯一寫入點
├── HotkeyManager         // 全域快捷鍵 (CGEvent)
├── MaskingCoordinator    // 遮蔽狀態中樞 + pattern 匹配
└── IPCServer             // localhost WebSocket
```

---

## VaultManager

管理 `vault.json` 讀寫及所有結構資料（Service、KeyEntry、LinkedGroup、ContextMode）的 CRUD 操作。

### 主要方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `addKey(label, serviceId, pattern, maskFormat, value)` | `throws → KeyEntry` | 建立新 KeyEntry，儲存 value 至 Keychain，透過 NotificationCenter 廣播 |
| `deleteKey(keyId)` | `throws → Void` | 從 vault 移除 KeyEntry，從 Keychain 刪除 |
| `getKeys(serviceId)` | `→ [KeyEntry]` | 取得某服務下所有 KeyEntry |
| `createLinkedGroup(label, keyIds, pasteMode)` | `throws → LinkedGroup` | 建立有序的 LinkedGroup |
| `getLinkedGroup(groupId)` | `→ LinkedGroup?` | 取得 LinkedGroup 完整詳情，不存在回傳 nil |
| `activeContext()` | `→ ContextMode` | 回傳當前啟用的 ContextMode |
| `switchContext(contextId)` | `throws → Void` | 切換情境並廣播狀態變更，持久化至磁碟 |
| `exportStructure()` | `throws → Data` | 匯出 vault.json 內容用於備份 |
| `importStructure(data)` | `throws → Void` | 從備份匯入 vault.json，驗證後覆蓋本地 |

### 錯誤處理

| 錯誤情境 | 處理策略 |
|---------|---------|
| vault.json 毀損 | 嘗試從 `vault.json.backup` 自動復原；失敗則通知使用者並建立空 vault |
| Keychain 寫入失敗 | 回滾 vault.json 變更，向使用者顯示錯誤訊息 |
| 磁碟寫入競爭 | 使用 atomic write（先寫入暫存檔再 rename），確保不會產生部分寫入 |

> VaultManager 在每次結構變更時寫入磁碟，並透過 NotificationCenter 廣播通知所有系統元件。

---

## KeychainService

純 Keychain CRUD 操作，無商業邏輯。**這是唯一接觸明文金鑰的模組。**

### 配置

| 項目 | 值 |
|------|-----|
| Service 前綴 | `com.demosafe.key` |
| kSecAttrAccessible | `whenUnlockedThisDeviceOnly` |
| Touch ID | 使用者可在設定中開啟 |

### 方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `storeKey(keyId, value)` | `throws → Void` | 加密並儲存 value 至 Keychain |
| `retrieveKey(keyId)` | `throws → Data` | 從 Keychain 取得明文 |
| `deleteKey(keyId)` | `throws → Void` | 從 Keychain 移除金鑰 |

### 錯誤情境

| 錯誤 | 原因 | 說明 |
|------|------|------|
| `keychainItemNotFound` | keyId 無對應項目 | retrieveKey / deleteKey 時觸發 |
| `keychainDuplicateItem` | 同 keyId 已存在 | storeKey 時觸發 |
| `keychainAuthFailed` | 裝置鎖定或 Touch ID 拒絕 | retrieveKey 時觸發 |
| `keychainUnexpected(OSStatus)` | 其他 Security.framework 錯誤 | 包裝 OSStatus 原始碼 |

---

## ClipboardEngine

管理所有剪貼簿操作和剪貼簿內容中的金鑰偵測。

### 關鍵操作流程

`copyToClipboard(keyId)` 是**明文離開 Keychain 的唯一路徑**：

1. 從 Keychain 取得明文
2. 寫入 NSPasteboard
3. 將明文變數歸零清除

### 方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `copyToClipboard(keyId)` | `throws → Void` | 唯一的明文輸出路徑；失敗時不會殘留明文 |
| `clearClipboard()` | `→ Void` | 立即清除 NSPasteboard |
| `startAutoClear(seconds)` | `→ Void` | 排程自動清除；重複複製時重置計時器 |
| `detectKeysInClipboard()` | `→ [DetectedKey]` | 掃描剪貼簿內容比對所有 pattern |

### 邊界行為

| 情境 | 處理 |
|------|------|
| 連續複製同一 Key | 重置 autoClear 計時器，不產生重複寫入 |
| 連續複製不同 Key | 清除前次計時器，寫入新 Key 並啟動新計時器 |
| 外部程式清除剪貼簿 | autoClear 計時器自然到期後 clearClipboard 為 no-op |
| copyToClipboard 失敗 | 不寫入 NSPasteboard，不啟動 autoClear，向使用者顯示錯誤 |

### DetectedKey 結構

完整定義參見 [data-model.md → DetectedKey](data-model.md#detectedkey偵測結果)。

簡要：`rawValue`、`suggestedService`、`pattern`、`confidence`（0.0–1.0 信心分數）

---

## HotkeyManager

使用 `CGEvent.tapCreate` 管理全域鍵盤快捷鍵，實現系統級快捷鍵攔截。

### 已註冊快捷鍵

| 快捷鍵 | 方法 | 說明 |
|--------|------|------|
| `⌃⌥Space` | `toggleToolbox()` | 顯示/隱藏浮動工具箱 |
| `⌃⌥⌘D` | `toggleDemoMode()` | 切換展示/一般模式 |
| `⌃⌥⌘[1-9]` | `pasteKeyByIndex()` | 依快捷鍵索引貼上金鑰 |
| `⌃⌥⌘V` | `captureClipboard()` | 掃描並儲存當前剪貼簿內容 |

### 按住偵測邏輯

```
keyDown → 顯示工具箱 → 監聽打字 → 轉發至搜尋欄位
keyUp → 判斷貼上或鎖定
```

### 其他方法

| 方法 | 說明 |
|------|------|
| `register(action, modifiers, keyCode)` | 註冊快捷鍵 |
| `unregister(action)` | 取消註冊快捷鍵 |
| `detectConflicts() → [ConflictingApp]` | 偵測快捷鍵衝突 |

---

## MaskingCoordinator

遮蔽狀態中樞。發佈 `isDemoMode` 和 `activeContext` 作為 `@Published` 屬性供 SwiftUI 綁定。

### @Published 屬性

| 屬性 | 型別 | 說明 |
|------|------|------|
| `isDemoMode` | `Bool` | 展示模式開關，SwiftUI 綁定 Menu Bar 圖示狀態 |
| `activeContext` | `ContextMode` | 當前啟用情境，驅動遮蔽等級和剪貼簿策略 |

### 主要方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `shouldMask(text)` | `→ [MaskResult]` | 掃描文字中所有匹配的 pattern，回傳所有匹配結果陣列；無匹配時回傳空陣列 |
| `maskedDisplay(keyId)` | `→ String` | 回傳金鑰的遮蔽表示用於 UI 顯示 |
| `broadcastState()` | `→ Void` | 透過 IPCServer 將當前狀態傳送至所有已連線 Extension |

### MaskResult 結構

完整定義參見 [data-model.md → MaskResult](data-model.md#maskresult回傳型別)。

### Pattern 匹配策略

| 項目 | 說明 |
|------|------|
| 匹配順序 | 依 pattern 長度降序（較具體的 pattern 優先） |
| 正規表達式編譯 | 啟動時一次編譯所有 pattern 為 `NSRegularExpression`，快取重用 |
| 執行緒安全 | pattern cache 為 read-only snapshot；變更時以 copy-on-write 替換 |
| 效能 | 單次掃描同時匹配所有 pattern，避免重複遍歷 |

> 所有 pattern 匹配集中在 MaskingCoordinator。Extension 訂閱狀態變更並透過此協調點同步本地快取。

---

## IPCServer

localhost WebSocket 伺服器，自動分配 port。依類型追蹤已連線的客戶端（vscode、chrome、accessibility）。

### Port 探索機制

IPCServer 建立 `~/.demosafe/ipc.json`，內容為 `{port, pid, version}`，供 Extension 探索連線資訊。

### 主要方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `start(preferredPort: UInt16?)` | `throws → UInt16` | 啟動 WebSocket 伺服器；回傳實際綁定的 port |
| `stop()` | `→ Void` | 關閉所有連線並停止監聽 |
| `broadcast(event, to: ClientType?)` | `→ Void` | 向指定類型或所有已連線客戶端廣播 event |
| `connectedClients()` | `→ [ClientInfo]` | 回傳目前已連線客戶端清單 |

### 主要職責

- 處理 WebSocket 連線並透過 handshake token 驗證
- 將 Extension 的 request（`get_state`、`request_paste`、`submit_detected`）路由至對應 handler
- 向所有已連線客戶端廣播 event（`state_changed`、`pattern_cache_sync`、`key_updated`、`clipboard_cleared`）

### ipc.json 完整結構

```json
{
  "port": 49152,
  "pid": 12345,
  "version": "1.0.0",
  "token": "random-256bit-hex-string"
}
```

- token 在每次 Core 啟動時重新產生（`SecRandomCopyBytes` 產生 32 bytes → hex 編碼）
- Core 重啟後舊 token 立即失效，Extension 需重新讀取 ipc.json 並 handshake

---

## 模組依賴關係

```
HotkeyManager → MaskingCoordinator → VaultManager → KeychainService
MaskingCoordinator → IPCServer → ClipboardEngine
```

依賴關係形成有向無環圖（DAG），確保：
- 清晰的資料流方向
- 個別模組的可測試性
- 便於依賴注入
- **無循環依賴**
