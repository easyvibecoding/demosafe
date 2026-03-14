# 🛡️ Secret Shield v2 - VS Code 終端機主動防禦

**在終端輸出到達螢幕之前，攔截並遮蔽 API key、密碼等敏感資訊。**

專為 Claude Code 展示操作、直播寫程式、錄影教學設計。

---

## 原理架構

```
┌─────────────────────────────────────────────────┐
│  VS Code Terminal (你看到的畫面)                  │
│  敏感資訊已被替換為 ••••••••••                     │
└───────────────────────┬─────────────────────────┘
                        │ onDidWrite (已過濾)
                        │
┌───────────────────────┴─────────────────────────┐
│  Secret Shield (代理層)                           │
│  node-pty 的輸出 → regex 偵測 → 替換 → 轉發       │
└───────────────────────┬─────────────────────────┘
                        │ onData (原始輸出)
                        │
┌───────────────────────┴─────────────────────────┐
│  node-pty (真實 shell 程序)                       │
│  bash / zsh / powershell                         │
└─────────────────────────────────────────────────┘
```

關鍵差異：不是在畫面上「蓋住」文字，而是**在文字到達終端之前就已經替換掉了**。
觀眾即使截圖、錄影回放，都看不到原始的敏感資訊。

---

## 快速開始

### 1. 安裝

```bash
git clone <repo-url>
cd secret-shield-vscode
npm install
npm run compile
```

在 VS Code 中按 `F5` 除錯執行。

### 2. 使用

| 操作 | 方式 |
|------|------|
| 開啟受保護終端 | `Ctrl+Shift+T` 或命令面板搜尋 "Shield Terminal" |
| 切換 Shield 開關 | `Ctrl+Shift+H` |
| 展示模式（一鍵啟用 + 開終端）| 命令面板搜尋 "Presentation Mode" |
| 開啟終端並直接執行 Claude | 命令面板搜尋 "Open Terminal With Command" → 輸入 `claude` |

### 3. 搭配 Claude Code

```
1. Ctrl+Shift+H 啟用 Shield
2. Ctrl+Shift+T 開啟受保護終端
3. 在終端中輸入 claude 開始使用
4. 所有終端輸出中的 API key 自動被遮蔽
5. 開始展示/直播
```

---

## 內建偵測模式

自動偵測並遮蔽：

- `sk-ant-*` — Anthropic API Key
- `sk-*` — OpenAI API Key
- `AKIA*` — AWS Access Key
- `ghp_*` / `ghs_*` — GitHub Token
- `AIza*` — Google API Key
- `xox[baprs]-*` — Slack Token
- `Bearer *` — Bearer Token
- `eyJ*.eyJ*.*` — JWT Token
- `-----BEGIN PRIVATE KEY-----` — 私鑰
- `postgres://` / `mongodb://` — 資料庫連線字串
- `password=*` / `secret=*` — 通用密碼設定

---

## 自訂模式

在 `settings.json` 中新增你自己的偵測規則：

```json
{
  "secretShield.customPatterns": [
    {
      "name": "My Company Token",
      "regex": "myco_[a-zA-Z0-9]{32}",
      "mask": "myco_••••••••"
    }
  ]
}
```

---

## 設定選項

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `secretShield.autoEnable` | `false` | 啟動 VS Code 時自動啟用 |
| `secretShield.shellPath` | 系統預設 | 自訂 shell 路徑 |
| `secretShield.shellArgs` | `[]` | 自訂 shell 參數 |
| `secretShield.customPatterns` | `[]` | 自訂偵測模式 |

---

## node-pty 安裝注意

此擴充套件需要 `node-pty` 原生模組。

**macOS：** `xcode-select --install`
**Windows：** `npm install --global --production windows-build-tools`
**Linux：** `sudo apt install build-essential`

如果 node-pty 無法安裝，可以使用備用終端（命令面板 → "Secret Shield: 開啟備用終端"）。

---

## 授權

Apache License 2.0 — 見專案根目錄 [LICENSE](../LICENSE)
