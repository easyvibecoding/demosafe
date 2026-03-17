# 支援平台

DemoSafe 目前支援以下平台的主動金鑰截取與遮蔽：

| 平台 | Key Prefix | 截取方式 | 狀態 |
|------|-----------|---------|------|
| GitHub | `ghp_`, `github_pat_`, `gho_` | DOM 掃描 + 遮蔽 | ✅ 已測試 |
| HuggingFace | `hf_` | Input 隱藏 + 截取 | ✅ 已測試 |
| GitLab | `glpat-` | Input 輪詢 + 截取 | ✅ 已測試 |
| OpenAI | `sk-proj-`, `sk-or-v1-` | Input 隱藏 (React SPA) | ✅ 已測試 |
| Anthropic | `sk-ant-` | 文字隱藏 + 遮蔽 | ✅ 已測試 |
| Google AI Studio | `AIzaSy` | 剪貼簿攔截 | ✅ 已測試 |
| Google Cloud | `AIzaSy` | Dialog input 截取 | ✅ 已測試 |
| AWS | `AKIA` + Secret Key | DOM 遮蔽 + 剪貼簿攔截 | ✅ 已測試 |
| Stripe | `sk_live_`, `pk_live_`, `rk_live_` | Pattern 已定義 | ⏳ 未測試 |
| Slack | `xoxb-`, `xoxp-`, `xapp-` | Pattern 已定義 | ⏳ 未測試 |
| SendGrid | `SG.` | Pattern 已定義 | ⏳ 未測試 |

## 新增平台支援

API Key 的生態系統非常多元 — 數百個平台各有獨特的 key 格式、UI 結構和前端框架。我們無法內建支援所有平台。

我們的架構採用 **Single Source of Truth** 設計：新增一個平台只需在 `capture-patterns.ts` 加一筆定義 + 在 `manifest.json` 加 URL match，不需修改其他程式碼。

### 如何貢獻

如果你使用的平台尚未支援，歡迎貢獻！

1. **開 Issue** — 描述平台名稱、key 格式（prefix、長度）、顯示 key 的 URL。附上 key 建立流程的截圖會非常有幫助。

2. **提交 PR** — 在 [`capture-patterns.ts`](../packages/chrome-extension/src/content-scripts/capture-patterns.ts) 加入新的 pattern 定義，並在 `manifest.json` 加入 URL match。

3. **使用分析 Skill** — 如果你有 Claude Code，執行 `/analyze-platform <url>` 可以自動分析平台的 DOM 結構並生成 pattern 定義。

### 平台特殊問題

不同平台使用不同的前端框架和 key 顯示方式，常見挑戰：

- **React / Vue SPA** — `input.value` 被框架覆蓋；key 必須透過 CSS 隱藏而非替換值
- **Clipboard API** — 部分平台使用 `navigator.clipboard.writeText`；需要 MAIN world 腳本注入
- **動態 class 名稱** — 混淆的 CSS class 每次 build 會改變；selector 必須使用穩定屬性（`role`, `data-*`, `aria-label`）
- **子域名變化** — 如 AWS 使用區域子域名（`us-east-1.console.aws.amazon.com`）

歡迎任何回饋、bug 報告或貢獻來擴展平台覆蓋範圍！
