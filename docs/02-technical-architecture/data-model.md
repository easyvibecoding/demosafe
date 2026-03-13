# 資料模型

## 核心實體

### KeyEntry

| 屬性 | 型別 | 必要性 | 說明 |
|------|------|--------|------|
| `id` | UUID | 必要 | 金鑰記錄唯一識別碼 |
| `label` | String | 必要 | 使用者友善的金鑰名稱 |
| `serviceId` | UUID | 必要 | 所屬 Service 的參照 |
| `encryptedValue` | Data (Keychain) | 必要 | 明文僅儲存於 macOS Keychain |
| `pattern` | String (regex) | 必要 | 用於偵測該金鑰的正規表達式 |
| `maskFormat` | MaskFormat | 必要 | 顯示規則：前綴、後綴、遮蔽字元、分隔符 |
| `shortcutIndex` | Int? | 選填 | 快速貼上的快捷鍵索引（1-9） |
| `linkedGroupId` | UUID? | 選填 | 所屬 LinkedGroup 的參照 |
| `createdAt` | Date | 自動 | 建立時間戳記 |
| `updatedAt` | Date | 自動 | 最後修改時間戳記 |

### Service

| 屬性 | 型別 | 必要性 | 說明 |
|------|------|--------|------|
| `id` | UUID | 必要 | 服務的唯一識別碼 |
| `name` | String | 必要 | 服務名稱（如 AWS、GitHub） |
| `icon` | String? | 選填 | 服務圖示參照 |
| `defaultPatterns` | [String] | 必要 | 該服務的預設正規表達式陣列 |
| `children` | [KeyEntry] | 計算 | 該服務下的金鑰記錄陣列 |

### LinkedGroup

| 屬性 | 型別 | 必要性 | 說明 |
|------|------|--------|------|
| `id` | UUID | 必要 | 群組的唯一識別碼 |
| `label` | String | 必要 | 使用者友善的群組名稱 |
| `entries` | [KeyEntry] | 必要 | 有序的金鑰記錄陣列 |
| `pasteMode` | PasteMode | 必要 | MVP：僅實作 `.selectField`。`.sequential` 保留供未來版本 |

### MaskFormat

| 屬性 | 型別 | 必要性 | 說明 |
|------|------|--------|------|
| `showPrefix` | Int | 必要 | 顯示前導字元數量 |
| `showSuffix` | Int | 必要 | 顯示末尾字元數量 |
| `maskChar` | Character | 必要 | 遮蔽字元（預設：`*`） |
| `separator` | String | 必要 | 前綴與後綴之間的分隔字串（預設：`...`） |

### ContextMode

| 屬性 | 型別 | 必要性 | 說明 |
|------|------|--------|------|
| `id` | UUID | 必要 | Context 的唯一識別碼 |
| `name` | String | 必要 | Context 名稱（如「直播中」、「開發中」） |
| `maskingLevel` | Enum | 必要 | `.full`（全部遮蔽）\| `.partial`（部分遮蔽）\| `.off`（關閉） |
| `clipboardTTL` | Int? | 選填 | 剪貼簿自動清除秒數 |
| `activeServiceIds` | [UUID]? | 選填 | 在此 Context 中需遮蔽的服務清單 |
| `shortcutKey` | String? | 選填 | 啟用此 Context 的快捷鍵 |

> MVP 注意：Context 預設為固定值（直播中、開發中），動態 Context 切換保留至未來版本。

---

### PasteMode（列舉）

| 值 | 說明 | 階段 |
|----|------|------|
| `.selectField` | 使用者手動選擇要貼上的欄位，工具箱顯示群組內所有 Key 供選擇 | **MVP** |
| `.sequential` | 按快捷鍵依序自動貼上群組內下一個 Key（如先 Access Key ID 再 Secret Key） | 未來版本 |

---

### MaskResult（回傳型別）

`MaskingCoordinator.shouldMask(text)` 的回傳結構：

| 屬性 | 型別 | 說明 |
|------|------|------|
| `keyId` | UUID | 匹配到的 KeyEntry 識別碼 |
| `matchedRange` | Range\<String.Index\> | 原始文字中匹配的範圍 |
| `maskedText` | String | 遮蔽後的顯示文字（如 `sk-proj-****...****`） |
| `pattern` | String | 匹配到的 regex pattern |
| `serviceId` | UUID | 所屬服務識別碼 |

> 當文字不含已知 pattern 時回傳 `nil`。

---

### DetectedKey（偵測結果）

`ClipboardEngine.detectKeysInClipboard()` 和 Extension `submit_detected` 的共用結構：

| 屬性 | 型別 | 說明 |
|------|------|------|
| `rawValue` | String | 偵測到的原始金鑰值 |
| `suggestedService` | String? | 根據 pattern 前綴推斷的服務名稱 |
| `pattern` | String | 匹配到的 regex pattern |
| `confidence` | Double (0.0–1.0) | 信心分數：1.0 = 完全匹配已知 pattern；< 0.5 = 模糊匹配，需使用者確認 |

> 信心分數計算依據：pattern 匹配精確度、Key 長度是否在預期範圍、前綴是否完全吻合已知服務。

---

## 實體關係

```
ContextMode 控制 → Service (1:N) → KeyEntry → 可選 LinkedGroup
```

- 單一 ContextMode 可啟用多個 Service
- 每個 Service 包含多個 KeyEntry
- KeyEntry 可選擇性加入 LinkedGroup，用於欄位選擇或循序貼上操作

## 儲存策略

| 資料類型 | 儲存位置 | 存取控制 |
|---------|---------|---------|
| `encryptedValue`（明文金鑰） | macOS Keychain (`com.demosafe.key.{UUID}`) | 系統級加密 + 可選 Touch ID |
| 結構資料（Service, Group, Context） | `~/Library/Application Support/DemoSafe/vault.json` | 檔案權限，使用者層級 |
| 使用者偏好設定 | `UserDefaults (com.demosafe)` | 使用者層級偏好 |

Keychain 使用 `kSecAttrAccessible` 設為 `whenUnlockedThisDeviceOnly`，確保金鑰僅在裝置解鎖時可用。
