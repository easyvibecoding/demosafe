# 安全規則

## 安全紅線（不可違反）

以下規則是 Demo-safe 的硬性安全保證，任何實作都**絕對不可違反**：

### 1. 明文金鑰只存在 Keychain

- 不寫入 `vault.json`
- 不存入 `UserDefaults`
- 不寫入任何日誌檔案
- 不存入任何暫存檔

### 2. 明文金鑰唯一流經路徑

```
Keychain → ClipboardEngine → NSPasteboard
```

- `KeychainService.retrieveKey()` 是唯一讀取明文的入口
- `ClipboardEngine.copyToClipboard()` 是唯一的明文輸出路徑
- 明文變數使用後立即歸零清除

### 3. IPC 不傳輸明文

- `pattern_cache_sync` 只帶 regex + masked preview
- `state_changed` 只帶模式狀態
- `key_updated` 只帶 keyId + pattern，不帶 value
- 所有 IPC 訊息中的金鑰僅以遮蔽表示傳輸

### 4. WebSocket 僅綁定 127.0.0.1

- 禁止綁定 `0.0.0.0` 或任何外部介面
- 僅接受 localhost 連線
- 防止遠端存取

### 5. ipc.json 權限 chmod 600

- `~/.demosafe/ipc.json` 僅限使用者讀寫
- 防止其他使用者或程序讀取連線資訊

---

## 儲存安全

| 資料 | 位置 | 安全等級 |
|------|------|---------|
| 明文金鑰 | macOS Keychain (`com.demosafe.key.{UUID}`) | 系統級加密 + 可選 Touch ID |
| 結構資料 | `~/Library/Application Support/DemoSafe/vault.json` | 檔案系統權限 |
| 偏好設定 | `UserDefaults` | 使用者級別 |
| IPC 連線資訊 | `~/.demosafe/ipc.json` | chmod 600 |

### Keychain 存取控制

- `kSecAttrAccessible`: `whenUnlockedThisDeviceOnly`
- 金鑰僅在裝置解鎖時可用
- 可選啟用 Touch ID 生物辨識驗證

---

## 剪貼簿安全

| 情境模式 | 自動清除策略 |
|---------|-------------|
| 直播中 (Livestream) | 30 秒後自動清除 |
| 教學錄影 (Tutorial Recording) | 10 秒後自動清除 |
| 內部展示 (Internal Demo) | 正常剪貼簿行為 |
| 開發中 (Development) | 正常剪貼簿行為 |

### 剪貼簿操作流程

1. `ClipboardEngine.copyToClipboard(keyId)` 從 Keychain 取得明文
2. 寫入 NSPasteboard
3. 明文變數立即歸零
4. 根據情境模式，排程 `startAutoClear(seconds)` 自動清除

---

## IPC 安全

### 連線驗證

1. Extension 從 `ipc.json` 讀取 port 和 token
2. 透過 WebSocket 連線至 `ws://127.0.0.1:{port}`
3. 發送 `handshake` request 帶入 `clientType` 和 `token`
4. Core 驗證 token 後才接受後續 request

### Handshake Token 機制

| 項目 | 說明 |
|------|------|
| 產生方式 | `SecRandomCopyBytes` 產生 32 bytes 密碼學安全亂數 → hex 編碼為 64 字元字串 |
| 生命週期 | 每次 Core 啟動時重新產生；Core 關閉後舊 token 自動失效 |
| 儲存位置 | 寫入 `~/.demosafe/ipc.json`（chmod 600） |
| 輪替策略 | Core 重啟即輪替；不支援運行中手動輪替（無此需求，因綁定 localhost） |
| 驗證失敗處理 | Core 回傳 `AUTH_FAILED` 錯誤，不關閉連線（允許 Extension 重新讀取 ipc.json 後重試） |

### 自動重連

- 指數退避：1s → 2s → 4s → 最大 30s + 隨機抖動
- 重連時需重新完成 handshake 驗證
- 重連時 Extension 應重新讀取 `ipc.json`（Core 可能已重啟，port/token 已變更）

---

## 遮蔽安全保證

> 在展示模式下，API Key 明文**不得出現在任何顯示器的任何時刻**。這不是盡力而為的過濾——而是**硬性保證**。

### 遮蔽層級防護

| 層級 | 覆蓋範圍 | 離線時行為 |
|------|---------|-----------|
| VS Code Extension | 編輯器內文件 | 使用 cached pattern 持續遮蔽 |
| Chrome Extension | 已知 API 頁面 | 使用 cached pattern 持續遮蔽 |
| Accessibility Agent | 全系統所有應用程式 | 使用 cached pattern 持續遮蔽 |

**關鍵原則：Extension 在 Core 離線時使用最後的 cached pattern 持續運作，確保即使 Core 不可用也維持保護。**

---

## activeServiceIds 與安全保證的關係

ContextMode 的 `activeServiceIds` 欄位可限制特定情境下啟用遮蔽的服務範圍。其安全語義如下：

| maskingLevel | activeServiceIds | 行為 |
|-------------|-----------------|------|
| `.full` | nil（未設定） | **所有已註冊 Key 全部遮蔽**——硬性保證成立 |
| `.full` | 指定部分服務 | **僅指定服務的 Key 被遮蔽**——其餘服務的 Key 不進行 pattern 匹配（相當於對未列入服務暫停遮蔽） |
| `.partial` | 任意 | 顯示前綴 + 末碼，僅隱藏中段——適用於內部展示，降低安全等級 |
| `.off` | 任意 | 遮蔽完全停用——僅限開發模式 |

> **設計決策**：`activeServiceIds` 是為了讓使用者在內部展示場景彈性控制。在「直播中」和「教學錄影」的預設情境中，此欄位為 nil（遮蔽所有服務），確保硬性安全保證不受影響。
