# Platform Scraper Toolkit（開發者維護工具）

> 狀態：❌ 尚未實作
> 類型：開發者工具（Agent Skill，非獨立 runtime 功能）

---

## 概述

各 API 平台的 UI 會隨時間更新，導致 DOM 結構、CSS class、key 顯示方式改變。Platform Scraper Toolkit 是一組**給 AI Agent 使用的指令和 prompt**，搭配 Chrome 瀏覽器自動化 MCP tools，用來：

1. **探測**：Agent 導航到目標平台頁面，用 JavaScript 提取當前 DOM 結構
2. **比對**：與 `capture-patterns.ts` 中記錄的 selector 比較，找出變化
3. **更新**：Agent 輸出新的 selector 建議，開發者確認後更新程式碼

**核心理念**：不寫獨立的 CDP 腳本。開發者的 AI Agent（如 Claude Code）已經有 Chrome MCP tools，直接用它們探測。維護成本最低。

---

## 可用的 Agent Skills（MCP Tools）

| Tool | 用途 |
|------|------|
| `mcp__claude-in-chrome__tabs_context_mcp` | 取得當前 Chrome 分頁列表 |
| `mcp__claude-in-chrome__tabs_create_mcp` | 建立新分頁 |
| `mcp__claude-in-chrome__navigate` | 導航到目標 URL |
| `mcp__claude-in-chrome__javascript_tool` | 在頁面上執行 JavaScript（DOM 分析核心） |
| `mcp__claude-in-chrome__read_page` | 取得 accessibility tree |
| `mcp__claude-in-chrome__get_page_text` | 取得頁面純文字 |

這些 tools 等同於 chrome-cdp-skill 的功能，但已內建在 Claude Code 中，不需額外安裝。

---

## 使用方式

### 場景 1：平台 UI 更新偵測

開發者對 AI Agent 說：

```
「OpenAI 的 key 頁面好像改版了。
請到 platform.openai.com/api-keys 分析 DOM 結構，
比對 capture-patterns.ts 中的 OpenAI selectors，
告訴我哪些 selector 需要更新。」
```

Agent 執行流程：
1. `navigate` → `platform.openai.com/api-keys`
2. `javascript_tool` → 執行 DOM 分析腳本（見下方）
3. 讀取 `capture-patterns.ts` 中的現有 selector
4. 比對差異 → 輸出建議更新

### 場景 2：新增平台支援

```
「幫我加入 Vercel 環境變數頁面的支援。
請到 vercel.com 的 project settings → environment variables，
分析 DOM 結構，建議 regex pattern 和 CSS selector，
然後更新 capture-patterns.ts 和 manifest.json。」
```

### 場景 3：定期巡檢

```
「請依序檢查以下平台的 API key 頁面 DOM 結構是否有變化：
OpenAI, Anthropic, GitHub, Google Cloud, Stripe, HuggingFace。
我已經在 Chrome 中都登入了。
比對 docs/11-platform-specific-capture-strategies.md 中記錄的結構。」
```

---

## DOM 分析 JavaScript 腳本

以下是 Agent 用 `javascript_tool` 執行的標準分析腳本。存放於專案中供 Agent 參考。

### `scripts/platform-analysis/analyze-dom.js`

```javascript
// 通用 DOM 分析腳本 — Agent 透過 javascript_tool 執行
(() => {
  const result = {
    url: window.location.href,
    hostname: window.location.hostname,
    timestamp: new Date().toISOString(),
    framework: null,
    elements: [],
    keyLikeTexts: [],
    modals: [],
    copyButtons: [],
    inputFields: [],
    customElements: [],
  };

  // 1. 偵測框架
  if (document.querySelector('[data-reactroot], [__reactFiber]') ||
      document.querySelector('[class*="css-"]')) {
    result.framework = 'react';
  } else if (document.querySelector('[_nghost], [ng-version]')) {
    result.framework = 'angular';
  } else if (document.querySelector('[data-svelte-h]')) {
    result.framework = 'svelte';
  }

  // 2. 找 key-like 文字的元素
  const keyPrefixes = [
    'sk-proj-', 'sk-ant-', 'sk-or-', 'AKIA', 'ASIA', 'AIzaSy',
    'sk_live_', 'sk_test_', 'pk_live_', 'pk_test_',
    'ghp_', 'github_pat_', 'gho_',
    'hf_', 'xoxb-', 'xoxp-', 'SG.', 'glpat-',
    'sk-...', 'hf_...', // 截斷版
  ];

  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
  );
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    for (const prefix of keyPrefixes) {
      if (text.includes(prefix)) {
        const parent = node.parentElement;
        result.keyLikeTexts.push({
          text: text.slice(0, 40) + (text.length > 40 ? '...' : ''),
          tag: parent?.tagName,
          classes: parent?.className?.toString().slice(0, 100),
          id: parent?.id,
          dataAttrs: Object.keys(parent?.dataset || {}),
          path: getElementPath(parent),
        });
        break;
      }
    }
  }

  // 3. 找 input 欄位
  document.querySelectorAll('input, textarea').forEach(el => {
    const input = el;
    if (input.value?.length > 10 || input.type === 'password') {
      result.inputFields.push({
        tag: input.tagName,
        type: input.type,
        name: input.name,
        id: input.id,
        classes: input.className?.toString().slice(0, 100),
        valueLength: input.value?.length || 0,
        readonly: input.readOnly,
        path: getElementPath(input),
      });
    }
  });

  // 4. 找 Copy 按鈕和 clipboard-copy 元素
  document.querySelectorAll('clipboard-copy, [data-clipboard], button').forEach(el => {
    const text = el.textContent?.toLowerCase() || '';
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
    if (el.tagName === 'CLIPBOARD-COPY' || text.includes('copy') || ariaLabel.includes('copy')) {
      result.copyButtons.push({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        value: el.getAttribute('value')?.slice(0, 20),
        classes: el.className?.toString().slice(0, 100),
        path: getElementPath(el),
      });
    }
  });

  // 5. 找 modal/dialog
  document.querySelectorAll('[role="dialog"], [data-state], dialog, .modal, [class*="modal"], [class*="dialog"]').forEach(el => {
    result.modals.push({
      tag: el.tagName,
      role: el.getAttribute('role'),
      dataState: el.getAttribute('data-state'),
      classes: el.className?.toString().slice(0, 100),
      visible: el.offsetParent !== null,
      childCount: el.children.length,
    });
  });

  // 6. 找自訂元素
  const allElements = document.body.querySelectorAll('*');
  const customTags = new Set();
  allElements.forEach(el => {
    if (el.tagName.includes('-')) customTags.add(el.tagName.toLowerCase());
  });
  result.customElements = [...customTags];

  // 7. 找穩定 vs 動態 class
  const stableClasses = [];
  const dynamicClasses = [];
  document.querySelectorAll('[class]').forEach(el => {
    const classes = el.className?.toString().split(/\s+/) || [];
    for (const cls of classes) {
      if (/^css-|^_|^[a-z]{5,7}$/.test(cls)) {
        if (!dynamicClasses.includes(cls)) dynamicClasses.push(cls);
      } else if (/^[a-z]+-[a-z]+/.test(cls) && cls.length > 5) {
        if (!stableClasses.includes(cls)) stableClasses.push(cls);
      }
    }
  });
  result.stableClassSamples = stableClasses.slice(0, 20);
  result.dynamicClassSamples = dynamicClasses.slice(0, 20);

  // 工具函數
  function getElementPath(el, depth = 4) {
    const parts = [];
    let current = el;
    for (let i = 0; i < depth && current && current !== document.body; i++) {
      let part = current.tagName?.toLowerCase() || '?';
      if (current.id) part += '#' + current.id;
      else if (current.className?.toString()) {
        const cls = current.className.toString().split(/\s+/)[0];
        if (cls && !/^css-|^_/.test(cls)) part += '.' + cls;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  return JSON.stringify(result, null, 2);
})()
```

---

## 報告存放

```
scripts/platform-analysis/
├── analyze-dom.js          # 通用 DOM 分析腳本（供 Agent 參考）
├── reports/                # 分析報告（.gitignore 排除）
│   ├── openai-2026-03-16.json
│   ├── anthropic-2026-03-16.json
│   └── ...
└── README.md               # 使用說明
```

`.gitignore` 加入：
```
scripts/platform-analysis/reports/
```

---

## 更新 capture-patterns.ts 流程

```
1. Agent 跑 DOM 分析 → 產生報告
2. Agent 讀取報告 + 讀取 capture-patterns.ts
3. Agent 比對差異：
   - selector 是否還存在？
   - key 格式（regex）是否需要調整？
   - 有沒有新的穩定 selector？
4. Agent 提出修改建議
5. 開發者確認 → Agent 修改 capture-patterns.ts
6. Build + lint + 測試
```

---

## 與獨立 CDP Script 的比較

| 面向 | Agent + MCP Tools（本方案） | 獨立 CDP Script |
|------|--------------------------|----------------|
| 安裝 | 零（已內建） | 需寫 + 維護 Node.js scripts |
| 執行 | 對話式，即時調整 | 命令列，需先寫好邏輯 |
| 適應變化 | Agent 看到新 DOM 自動調整分析策略 | 需人工修改 script |
| 跨平台 | 同一個 analyze-dom.js 通用 | 每平台一個 script |
| 維護成本 | 極低（Agent 自己看 DOM 分析） | 高（每次 UI 改版都要改 script） |
| 可重複性 | 透過 prompt 模板標準化 | 透過 script 標準化 |

**結論**：Agent + MCP Tools 方式更靈活，維護成本更低。獨立 script 只在需要 CI/CD 自動化排程時才有必要。

---

## Claude Code Custom Skill 整合

開發者可將 platform analysis 封裝為 Claude Code 的自訂 skill（slash command），讓任何貢獻者都能用 `/analyze-platform` 一鍵觸發分析。

### Skill 檔案結構

```
SafeApiKeyManager/
└── .claude/
    └── skills/
        └── analyze-platform/
            └── SKILL.md
```

放在**專案根目錄**的 `.claude/skills/` 下（不是 `~/.claude/`）。
Git 追蹤此目錄（`.gitignore` 排除 `.claude/*` 但保留 `!.claude/skills/`）。
所有 clone 此專案的開發者自動可用。

### SKILL.md 定義

```yaml
---
name: analyze-platform
description: Analyze API key page DOM structure for capture-patterns.ts maintenance. Use when a platform UI changes or adding a new platform.
context: fork
agent: Explore
---

# Platform DOM Analysis

Analyze the target API key management page to update capture-patterns.ts.

**Arguments**: $ARGUMENTS (platform name or URL, e.g., "openai" or "https://platform.openai.com/api-keys")

## Steps

1. **Navigate** to the target platform's API key page using Chrome MCP tools
2. **Execute** the analyze-dom.js script via `mcp__claude-in-chrome__javascript_tool`:
   - Read the script from `scripts/platform-analysis/analyze-dom.js`
   - Execute it on the target page
   - Parse the JSON output
3. **Compare** with current selectors in `packages/chrome-extension/src/content-scripts/capture-patterns.ts`
4. **Report** findings:
   - Which selectors still work
   - Which selectors have changed
   - New stable selectors found
   - Key format changes
5. **Save** the analysis report to `scripts/platform-analysis/reports/{platform}-{date}.json`

## Important
- Do NOT record actual API key values in the report (truncate to first 20 chars)
- After completion, list all browser URLs visited and JavaScript executed
- Do NOT click "Create key" buttons unless explicitly instructed
```

### 使用方式

```
開發者在 Claude Code 中輸入：

/analyze-platform openai

Agent 自動：
1. 導航到 platform.openai.com/api-keys
2. 執行 analyze-dom.js
3. 比對 capture-patterns.ts
4. 輸出差異報告
```

### Skill 設定說明

| Frontmatter 欄位 | 值 | 說明 |
|-----------------|-----|------|
| `name` | `analyze-platform` | Slash command 名稱 |
| `description` | 見上方 | 用途描述（Agent 可自動判斷是否觸發） |
| `context: fork` | — | 在隔離的 subagent 中執行，不影響主對話 |
| `agent: Explore` | — | 使用 Explore agent type（有瀏覽器 tools 存取） |

### 其他可用的 Skill

| Skill 名稱 | 用途 |
|-----------|------|
| `/analyze-platform` | 分析單一平台 DOM 結構 |
| `/analyze-all-platforms` | 批次分析所有已知平台 |
| `/update-capture-patterns` | 根據分析報告更新 capture-patterns.ts |
| `/test-capture` | 在測試頁面上驗證 capture 功能 |

---

## 安全考量

| 風險 | 對策 |
|------|------|
| Agent 看到真實 key | 分析腳本只記錄 DOM 結構（tag、class、path），key 文字截取前 20 字元 + `...` |
| 報告含使用者資訊 | `reports/` 加入 `.gitignore` |
| Agent 自動操作頁面 | Agent 完成後必須報告所有瀏覽器操作（見 memory: feedback_browser_automation_report） |
| 自動點擊 Create key | Agent 不主動建立 key，需開發者明確指示 |
