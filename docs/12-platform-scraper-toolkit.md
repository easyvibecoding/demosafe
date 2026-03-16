# Platform Scraper Toolkit（開發者維護工具）

> 狀態：❌ 尚未實作
> 類型：開發者工具（非 runtime 功能）

---

## 概述

各 API 平台的 UI 會隨時間更新，導致 DOM 結構、CSS class、key 顯示方式改變。Platform Scraper Toolkit 是一組開發者用的腳本，用來：

1. **探測**：連接到目標平台頁面，提取當前 DOM 結構和 key 顯示元素
2. **比對**：與 `capture-patterns.ts` 中記錄的 selector 比較，找出變化
3. **更新**：輸出新的 selector 建議，開發者微調後更新程式碼

**核心理念**：平台 UI 更新時，開發者只需跑 script + 微調，不需要從零研究 DOM。

---

## 設計架構

```
scripts/platform-scrapers/
├── README.md               # 使用說明
├── lib/
│   ├── browser.mjs         # 瀏覽器連接（CDP 或 Puppeteer）
│   ├── analyzer.mjs        # DOM 分析通用函數
│   └── reporter.mjs        # 輸出格式化
├── platforms/
│   ├── openai.mjs          # OpenAI 平台探測
│   ├── anthropic.mjs       # Anthropic 平台探測
│   ├── github.mjs          # GitHub 平台探測
│   ├── google-cloud.mjs    # Google Cloud 平台探測
│   ├── stripe.mjs          # Stripe 平台探測
│   ├── aws.mjs             # AWS 平台探測
│   ├── huggingface.mjs     # Hugging Face 平台探測
│   ├── slack.mjs           # Slack 平台探測
│   └── sendgrid.mjs        # SendGrid 平台探測
├── run-all.mjs             # 跑所有平台
└── update-patterns.mjs     # 根據探測結果更新 capture-patterns.ts
```

---

## 每個平台 Script 的職責

### 輸入

- 一個已登入的 Chrome 瀏覽器 session（使用者自己登入）
- 目標平台的 URL

### 動作

```
1. 導航到 API key 管理頁面
2. 分析 DOM 結構：
   - 掃描所有含 key-like 文字的元素
   - 記錄元素路徑：tagName、class、id、data-* 屬性
   - 識別 modal/dialog 容器
   - 偵測 Copy 按鈕和 Reveal/Show 按鈕
   - 檢查框架（React/Angular/Svelte）和 CSS 方案（Tailwind/Emotion/CSS modules）
3. 嘗試建立新 key（如果頁面有 Create 按鈕）：
   - 點擊 Create → 等待 modal/dialog → 掃描完整 key 的 DOM 位置
   - 記錄 key 出現的元素和周圍結構
4. 輸出結果
```

### 輸出格式

每個 script 輸出一個標準化的 JSON 報告：

```json
{
  "platform": "openai",
  "url": "https://platform.openai.com/api-keys",
  "scannedAt": "2026-03-16T09:00:00Z",
  "framework": "react",
  "cssStrategy": "emotion + semantic classes",
  "keyListPage": {
    "tableSelector": "table.api-keys-table",
    "keyCell": "td.api-key-token .api-key-token-value",
    "keyFormat": "truncated (sk-...xxxx)",
    "stableSelectors": ["api-key-token-value", "api-keys-table"],
    "dynamicSelectors": ["css-bmb8is", "lkCln"]
  },
  "keyCreation": {
    "createButton": "button containing 'Create new secret key'",
    "modalSelector": "[data-state='open']",
    "keyElement": "found in modal, element type: div/code/input",
    "keyFormat": "full key visible",
    "copyButton": "button in modal",
    "isOneTimeDisplay": true
  },
  "detectedKeyPatterns": [
    {
      "prefix": "sk-proj-",
      "regex": "sk-proj-[A-Za-z0-9_-]{80,}",
      "sampleLength": 160,
      "confidence": 0.95
    }
  ],
  "recommendations": {
    "primarySelector": "td.api-key-token .api-key-token-value",
    "modalWatchSelector": "[data-state]",
    "captureStrategy": "modal_watch",
    "notes": "Key only visible in create modal. Table shows truncated version."
  }
}
```

---

## 使用方式

### 前置需求

```bash
# 啟動 Chrome 並開啟 remote debugging
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# 或在已開啟的 Chrome 中啟用：
# chrome://inspect/#devices → Configure → localhost:9222
```

### 單一平台探測

```bash
# 確保已在 Chrome 中登入 OpenAI
node scripts/platform-scrapers/platforms/openai.mjs

# 輸出：
# ✓ Connected to Chrome (localhost:9222)
# ✓ Found tab: platform.openai.com/api-keys
# ✓ Analyzing DOM structure...
# ✓ Found key table: table.api-keys-table
# ✓ Found 3 keys (truncated format)
# ✓ Testing key creation flow...
# ✓ Create button found, clicking...
# ✓ Modal appeared: [data-state="open"]
# ✓ Full key detected in modal
#
# Report saved: reports/openai-2026-03-16.json
```

### 全部平台探測

```bash
node scripts/platform-scrapers/run-all.mjs
# 依序跑每個平台（需要在 Chrome 中各平台都已登入）
```

### 自動更新 patterns

```bash
node scripts/platform-scrapers/update-patterns.mjs
# 讀取所有 reports/*.json
# 比對 capture-patterns.ts 中的現有 selector
# 輸出差異報告 + 建議更新
# 開發者確認後自動更新 capture-patterns.ts
```

---

## 與 AI Agent 整合

開發者可以用自己的 AI agent（如 Claude Code）來協助：

### 場景 1：平台 UI 更新偵測

```
開發者：「OpenAI 的 key 頁面好像改版了，幫我跑 scraper 看看」
Agent：
  1. 跑 openai.mjs → 產生新報告
  2. 比對舊報告 → 找出 selector 變化
  3. 建議更新 capture-patterns.ts 的哪些欄位
  4. 開發者確認 → 自動更新程式碼
```

### 場景 2：新增平台支援

```
開發者：「幫我加入 Vercel 的支援」
Agent：
  1. 建立 scripts/platform-scrapers/platforms/vercel.mjs
  2. 連接到 Vercel dashboard → 分析 DOM
  3. 產生報告 → 建議 regex pattern 和 selector
  4. 更新 capture-patterns.ts 加入新平台
  5. 更新 manifest.json 加入 URL
```

### 場景 3：定期維護

```bash
# CI/CD 中可排程每月跑一次
node scripts/platform-scrapers/run-all.mjs
# 如果偵測到 selector 變化 → 開 Issue 通知維護者
```

---

## 實作順序

1. **`lib/browser.mjs`**：Chrome CDP 連接（參考 chrome-cdp-skill 的 WebSocket 方式）
2. **`lib/analyzer.mjs`**：DOM 分析通用函數（找 key 元素、識別框架、穩定 selector 判斷）
3. **`lib/reporter.mjs`**：JSON 報告格式化 + 差異比對
4. **`platforms/openai.mjs`**：第一個平台（最多參考資料）
5. 依序實作其他平台
6. **`update-patterns.mjs`**：自動更新 capture-patterns.ts
7. **`run-all.mjs`**：批次執行

---

## 技術選型

| 面向 | 選擇 | 理由 |
|------|------|------|
| 瀏覽器連接 | Chrome DevTools Protocol (CDP) | 不需安裝額外工具，直接連 Chrome |
| CDP 實作 | 直接 WebSocket（參考 chrome-cdp-skill） | 輕量，不依賴 Puppeteer/Playwright |
| Runtime | Node.js (ESM) | 與專案其他 TypeScript 工具一致 |
| 輸出 | JSON + Console | 機器可讀 + 人類可讀 |
| 報告儲存 | `scripts/platform-scrapers/reports/` | Git tracked（.gitignore 排除敏感 URL） |

---

## 安全考量

| 風險 | 對策 |
|------|------|
| Script 讀取到真實 key | 報告只記錄 DOM 結構和 selector，不記錄 key 值 |
| 報告含使用者資訊 | reports/ 加入 .gitignore，不進版控 |
| CDP 連線安全 | 僅 localhost:9222，不暴露外部 |
| 自動點擊 Create key | 預設不自動建立，需加 `--create-test-key` flag 明確啟用 |
