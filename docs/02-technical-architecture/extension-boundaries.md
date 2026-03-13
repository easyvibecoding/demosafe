# Extension 職責邊界

## VS Code Extension（MVP）

### 負責項目

| 類別 | 說明 |
|------|------|
| ✅ 做 | 使用本地 pattern cache 匹配開啟的文件 |
| ✅ 做 | 透過 VS Code Decoration API 渲染遮蔽 |
| ✅ 做 | 在 gutter 顯示鎖圖示標記受保護區域 |
| ✅ 做 | 監聽檔案變更並重新掃描 pattern |
| ✅ 做 | 維護從 Core 接收的 pattern cache |
| ✅ 做 | 透過 `submit_detected` 回報偵測到的金鑰 |
| ✅ 做 | 在狀態列顯示 Demo Mode 狀態 |
| ❌ 不做 | 儲存明文金鑰 |
| ❌ 不做 | 定義或管理 pattern |
| ❌ 不做 | 寫入剪貼簿 |
| ❌ 不做 | 管理金鑰 CRUD |
| ❌ 不做 | 處理快捷鍵貼上操作 |

### 核心迴圈

```
檔案開啟/變更 → regex 掃描（使用 cached pattern）
    → isDemoMode? → 套用或清除 decoration → gutter 圖示
```

### 離線降級

| 狀態 | 行為 |
|------|------|
| Core 離線、有 cache | 使用最後的 cached pattern 繼續遮蔽 |
| Core 離線、無 cache | 無法遮蔽，狀態列顯示「⚠ Demo-safe (No Cache)」警告 |
| Core 重新上線 | 自動重連 + 版本比對 → 增量或完整同步 |

- 狀態列顯示「⚠ Demo-safe (Offline)」
- 貼上功能不可用，顯示使用者通知
- cache 持久化於 VS Code `globalState`，跨 Extension 重啟保留

---

## Chrome Extension（Phase 2）

### 負責項目

| 類別 | 說明 |
|------|------|
| ✅ 做 | 透過 URL 比對和網域列表偵測已知 API 頁面 |
| ✅ 做 | 透過 content scripts 套用 DOM 遮蔽（CSS 覆蓋 + 文字替換） |
| ✅ 做 | 使用 content script 注入從頁面擷取金鑰 |
| ✅ 做 | 透過 `submit_detected` 將偵測到的金鑰傳送至 Core |
| ✅ 做 | 維護與 Core 同步的 pattern cache |
| ✅ 做 | 使用 MutationObserver 監控動態內容 |
| ❌ 不做 | 儲存明文金鑰 |
| ❌ 不做 | 使用 Chrome storage 存放金鑰資料 |
| ❌ 不做 | 直接處理貼上操作 |
| ❌ 不做 | 管理金鑰 CRUD |

### 連線架構

- Background Service Worker 維護與 Core 的 WebSocket 連線
- Native Messaging Host（Swift helper）讀取 `ipc.json` 以輔助探索

### Native Messaging Host 規格

Chrome Extension 無法直接讀取檔案系統（`~/.demosafe/ipc.json`），因此需要 Native Messaging Host 作為橋接：

| 項目 | 說明 |
|------|------|
| 實作語言 | Swift（macOS helper binary） |
| 安裝位置 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.demosafe.nmh.json` |
| 職責 | 讀取 `ipc.json` → 回傳 `{port, token}` 給 Background Service Worker |
| 通訊協定 | Chrome Native Messaging（stdin/stdout JSON） |
| 觸發時機 | Extension 啟動時呼叫一次取得連線資訊；Core 重啟後重新呼叫 |
| 安全性 | manifest 限定 `allowed_origins` 僅允許本 Extension ID |

---

## Accessibility Agent（Phase 3）

### 負責項目

| 類別 | 說明 |
|------|------|
| ✅ 做 | 透過 AXUIElement API 提供系統級文字攔截 |
| ✅ 做 | 套用涵蓋終端和系統工具的全應用程式遮蔽 |
| ✅ 做 | 監控多顯示器設定並提供一致覆蓋 |
| ❌ 不做 | 在 VS Code/Chrome Extension 已涵蓋的地方重複遮蔽 |

### 覆蓋協調

Core 維護覆蓋登錄表，告知 Accessibility Agent 哪些視窗已由已連線的 Extension 覆蓋，避免重複遮蔽。

---

## 職責矩陣總覽

| 能力 | Core | VS Code | Chrome | A11y Agent |
|------|------|---------|--------|------------|
| Pattern 定義 | ✓ 唯一 | — | — | — |
| Pattern 匹配 | 中央樞紐 | 本地 cache | 本地 cache | 本地 cache |
| 明文存取 | ✓ 唯一 | — | — | — |
| 剪貼簿寫入 | ✓ 唯一 | — | — | — |
| 遮蔽渲染 | — | Editor decoration | DOM overlay | 系統級 |
| 金鑰擷取 | 彙總 | 偵測 | 偵測 | 偵測 |
| 狀態管理 | 主要 | 接收 | 接收 | 接收 |
| 離線運作 | N/A | ✓ 可用 | ✓ 可用 | ✓ 可用 |
