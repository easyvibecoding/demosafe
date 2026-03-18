# IPC 協定規格

## 連線機制

### 連線建立流程

1. Core Engine 啟動，開啟 WebSocket 於 localhost（自動分配 port）
2. Core 寫入 `~/.demosafe/ipc.json`：`{port, pid, version}`
3. Extension 讀取 `ipc.json` 並連線 `ws://127.0.0.1:{port}`
4. Extension 發送 `handshake` 帶入 `clientType` 和認證 token
5. Core 驗證後接受後續 request

### 自動重連策略

指數退避：`1s → 2s → 4s → ... → max 30s`（加隨機 jitter）

---

## 訊息格式

所有訊息遵循 JSON 信封結構：

```json
{
  "id": "UUID",
  "type": "request | response | event",
  "action": "specific_action",
  "payload": { ... },
  "timestamp": "ISO8601"
}
```

---

## Request Actions（Extension → Core）

| Action | Payload | Response |
|--------|---------|----------|
| `handshake` | `clientType`（`vscode` / `chrome` / `accessibility` / `nmh`）, `token`, `version` | port, pid, patternCache version, 連線狀態 |
| `get_state` | (無) | isDemoMode, activeContext, patternCache, version |
| `request_paste` | `keyId` | status (`success` \| `denied` \| `offline`) |
| `request_paste_group` | `groupId`, `fieldIndex`（可選） | status, groupId |
| `submit_detected` | `rawValue`, `suggestedService`, `pattern`, `confidence` | isStored: Bool, keyId (如已儲存) |
| `resolve_mask` | `keyId`, `maskText` | canUnmask: Bool |

### resolve_mask 使用場景

`resolve_mask` 用於 Extension 向 Core 確認特定遮蔽文字是否可以解除遮蔽。主要用途：

- **管理模式下**：使用者在設定頁想要確認某個遮蔽文字對應哪個 Key
- **除錯場景**：開發模式下 Extension 需確認 pattern 匹配是否正確
- `canUnmask` 回傳 `false` 的情境：展示模式啟用中、keyId 不存在、token 驗證失敗

### 成功回應格式

```json
{
  "id": "對應 request 的 UUID",
  "type": "response",
  "action": "request_paste",
  "payload": { "status": "success" },
  "timestamp": "ISO8601"
}
```

### 錯誤回應格式

```json
{
  "id": "對應 request 的 UUID",
  "type": "response",
  "action": "request_paste",
  "payload": {
    "status": "error",
    "code": "KEY_NOT_FOUND",
    "message": "Requested keyId does not exist in vault"
  },
  "timestamp": "ISO8601"
}
```

### 錯誤碼定義

| 錯誤碼 | 說明 | 觸發情境 |
|--------|------|---------|
| `AUTH_FAILED` | Handshake token 無效或過期 | handshake 驗證失敗 |
| `KEY_NOT_FOUND` | 指定 keyId 不存在 | request_paste、resolve_mask |
| `GROUP_NOT_FOUND` | 指定 groupId 不存在 | request_paste_group |
| `DEMO_MODE_DENIED` | 展示模式下不允許此操作 | resolve_mask（canUnmask = false） |
| `KEYCHAIN_ERROR` | Keychain 存取失敗 | request_paste（裝置鎖定或 Touch ID 拒絕） |
| `INVALID_PAYLOAD` | Payload 格式錯誤或缺少必要欄位 | 所有 action |

---

## Event Actions（Core → Extension）

| Event | Payload | 說明 |
|-------|---------|------|
| `state_changed` | isDemoMode, activeContext | 遮蔽狀態變更時廣播 |
| `pattern_cache_sync` | version, patternArray, knownKeyLocations | 完整 cache 更新，用於離線韌性（結構詳見下方） |
| `key_updated` | action (`add` \| `update` \| `delete`), keyId, pattern | 增量 pattern 變更 |
| `clipboard_cleared` | timestamp | 剪貼簿已清除通知 |

---

## Pattern Cache 同步策略

Core 維護 `patternCacheVersion`，每次 pattern 變更時遞增。Extension 追蹤本地版本，落後時請求完整同步。

### pattern_cache_sync Payload 結構

```json
{
  "version": 42,
  "patternArray": [
    {
      "keyId": "UUID",
      "serviceId": "UUID",
      "serviceName": "OpenAI",
      "pattern": "sk-proj-[A-Za-z0-9_-]{20,}",
      "maskFormat": { "showPrefix": 8, "showSuffix": 0, "maskChar": "*", "separator": "..." },
      "maskedPreview": "sk-proj-****...****"
    }
  ],
  "knownKeyLocations": [
    {
      "keyId": "UUID",
      "filePaths": ["~/.env", "config/secrets.yaml"],
      "lastSeen": "ISO8601"
    }
  ]
}
```

- `patternArray`：所有啟用 Key 的 pattern + 遮蔽格式（**不含明文**）
- `knownKeyLocations`：Extension 先前回報偵測到 Key 的檔案路徑，用於優先掃描

### 離線 Cache 持久性

| 項目 | 說明 |
|------|------|
| 持久化位置 | Extension 將 cache 寫入本地 storage（VS Code: globalState / Chrome: chrome.storage.local） |
| 跨重啟保留 | ✅ Extension 重啟後自動載入上次 cache |
| 過期策略 | 無強制過期；重新連線後立即進行版本比對並同步 |
| 從未收到 cache | Extension 啟動時無 cache 且 Core 離線 → 無法遮蔽，狀態列顯示警告 |

### 同步觸發時機

| 觸發事件 | 同步類型 |
|---------|---------|
| Key 新增/刪除/修改 | `key_updated` event（增量） |
| Pattern 設定變更 | `pattern_cache_sync` event（完整） |
| 情境切換 | `state_changed` event |
| Extension 首次連線 | handshake response 帶完整 cache |

### 關鍵原則

> Extension 在 Core 離線時使用最後的 cached pattern 持續遮蔽。確保即使 Core 不可用也維持保護。

---

## NMH Relay（Native Messaging Host 短暫連線）

clientType `"nmh"` 為 Chrome Native Messaging Host 透過短暫 WS 連線轉發請求。

| 特性 | 說明 |
|------|------|
| 連線生命週期 | connect → handshake → 1 request → 1 response → close（~20-60ms） |
| 支援的 action | `get_state`、`submit_captured_key`、`toggle_demo_mode` |
| broadcast 排除 | Core broadcast events 時自動跳過 `.nmh` clients |
| 使用場景 | Chrome Extension WS 斷線時的 fallback 路徑 |

---

## 安全約束

| 規則 | 說明 |
|------|------|
| WebSocket 僅 127.0.0.1 | 禁止綁定外部介面 |
| Handshake 認證 | 需要 `ipc.json` 中的 token |
| **明文永不經過 IPC** | 僅遮蔽表示和參照流過網路 |
| **明文不存入 chrome.storage** | submit_captured_key 失敗時不 queue，遵守安全紅線 |
| `ipc.json` 權限 600 | 僅限使用者讀寫 |
