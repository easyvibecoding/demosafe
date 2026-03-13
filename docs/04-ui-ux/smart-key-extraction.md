# 智慧 Key 擷取

> 狀態：❌ 尚未實作（Phase 2 範圍）

## 概述

Smart Key Extraction 允許使用者從網頁、剪貼簿或檔案中自動偵測並匯入 API Key，取代手動逐一輸入。

---

## 擷取流程

### Step 1: 掃描
觸發方式（任一）：
- Menu Bar → Quick Actions → **Smart Extract Current Page**
- Chrome Extension content script 自動偵測
- `⌃⌥⌘V` 快捷鍵（掃描剪貼簿）

掃描來源：
- 網頁 DOM 內容（Chrome Extension）
- NSPasteboard 剪貼簿內容（ClipboardEngine）
- 開啟的檔案內容（VS Code Extension）

### Step 2: 識別
- 比對內建 regex 樣式庫（見 [masking-format.md](../06-pattern-reference/masking-format.md)）
- 根據 Key 前綴識別服務提供者（如 `sk-proj-` → OpenAI）
- 頁面 URL 輔助提升信心分數（如在 `console.anthropic.com` 偵測到 → 信心 +0.2）

### Step 3: 確認對話框
系統顯示擷取確認 UI，防止誤匯入：

```
偵測到 3 個 Key：

  ✓ OpenAI API Key          sk-proj-****    → 加入 OpenAI 群組？
  ✓ AWS Access Key ID       AKIA****        → 加入 AWS / Production？
  ✓ AWS Secret Key          ****            ↔ 與上方建立關聯？

  [ 全部加入 ]    [ 逐一確認 ]    [ 取消 ]
```

對話框功能：
- 每個偵測結果可個別勾選 / 取消
- 自動建議歸屬的 Service（可手動修改）
- 關聯 Key 自動提示建立 LinkedGroup
- 顯示信心分數，低於閾值（< 0.7）時以警告色標示

### Step 4: 儲存
- 使用者確認後，Key 值儲存至 Keychain（透過 KeychainService）
- KeyEntry 結構寫入 vault.json（透過 VaultManager）
- 觸發 `pattern_cache_sync` 廣播至所有已連線 Extension
- 如勾選關聯，建立 LinkedGroup

---

## DetectedKey 結構

```typescript
interface DetectedKey {
    rawValue: string;         // 偵測到的原始 Key 值
    suggestedService: string; // 建議的服務名稱
    pattern: string;          // 匹配的 regex pattern
    confidence: number;       // 信心分數 0.0 ~ 1.0
}
```

### 信心分數計算

| 因素 | 分數加成 | 說明 |
|------|---------|------|
| 前綴精確匹配 | +0.4 | 如 `sk-proj-`、`AKIA`、`ghp_` |
| 長度符合 | +0.2 | Key 長度在該服務的預期範圍內 |
| 頁面 URL 匹配 | +0.2 | 偵測時所在頁面為對應服務的控制台 |
| 字元集完全符合 | +0.1 | Base64、hex 等特定字元集 |
| 上下文線索 | +0.1 | 鄰近文字包含 "API Key"、"Secret" 等 |

---

## 觸發來源與流程

### 從 Chrome Extension 觸發

```
使用者點擊 "Smart Extract" 或自動偵測
    ↓
Content Script 掃描 DOM 文字節點 + input/textarea
    ↓
chrome.runtime.sendMessage({ type: 'submit_detected', payload: DetectedKey[] })
    ↓
Background → WebSocket → Core Engine
    ↓
Core Engine 顯示確認對話框
    ↓
使用者確認 → 儲存至 Vault + Keychain
```

### 從剪貼簿觸發（`⌃⌥⌘V`）

```
使用者按下 ⌃⌥⌘V
    ↓
HotkeyManager → ClipboardEngine.detectKeysInClipboard()
    ↓
回傳 [DetectedKey] 陣列
    ↓
顯示確認對話框
    ↓
使用者確認 → 儲存至 Vault + Keychain
```

---

## 關聯 Key 群組（Linked Groups）

部分服務需要多組相關 Key（如 AWS Access Key ID + Secret Key）。

### 功能

| 功能 | 說明 |
|------|------|
| **順序貼上** | 一個快捷鍵依序填入多個欄位（如 Access Key ID → Tab → Secret Key） |
| **欄位選取貼上** | 顯示清單讓使用者選擇要貼上群組中的哪個 Key |
| **批次匯出** | 將整個 Key 群組匯出為 `.env` 格式區塊 |
| **依賴追蹤** | 當群組中某個 Key 輪替時，提示更新關聯 Key |

### LinkedGroup 結構

```swift
struct LinkedGroup: Codable, Identifiable {
    let id: UUID
    var label: String           // 如 "AWS Production"
    var entries: [GroupEntry]    // 有序的 Key 列表
    var pasteMode: PasteMode    // .sequential 或 .fieldSelect
}

struct GroupEntry: Codable {
    let keyId: UUID
    let fieldLabel: String      // 如 "Access Key ID"、"Secret Key"
    var sortOrder: Int
}

enum PasteMode: String, Codable {
    case sequential    // 按 Tab 自動依序貼入
    case fieldSelect   // 顯示選單讓使用者選擇
}
```

### 順序貼上模擬

```
使用者觸發 LinkedGroup paste（⌃⌥[N] 對應群組）
    ↓
1. 貼上 entries[0].value（Access Key ID）
2. 模擬 Tab 鍵
3. 貼上 entries[1].value（Secret Key）
    ↓
完成，兩個欄位同時填入
```
