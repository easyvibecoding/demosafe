# 各平台 API Key 截取策略

> 狀態：✅ 核心架構已完成
> 已測試平台：GitHub (Classic PAT)、HuggingFace、Anthropic/Claude
> 最後更新：2026-03-17

---

## 設計原則

1. **通用掃描為基底**：TreeWalker + Regex 永遠運作，覆蓋所有頁面
2. **平台專屬選擇器為加速層**：針對已知平台的 DOM 結構，用 CSS selector 直接定位 key 元素
3. **不依賴動態 class name**：只用穩定的語義 class、自訂元素名、HTML 標籤結構
4. **偵測策略因平台而異**：一次性顯示的平台需要 MutationObserver 即時截取

---

## 平台分類與策略

### Category A：一次性顯示（必須即時截取）

#### OpenAI (`platform.openai.com/api-keys`)

**Key 格式**：`sk-proj-[A-Za-z0-9_-]{80,}`

**DOM 結構**：
- 列表頁：`<td class="api-key-token">` → `<div class="api-key-token-value">` 只有截斷版 `sk-...xxxx`
- 建立 Modal：Radix UI dialog（`[data-state="open"]`），完整 key 在 modal 內
- Copy 按鈕在 modal 中

**截取策略**：
```
1. MutationObserver 監聽 [data-state] 從 "closed" 變為 "open"
2. Modal 出現時掃描內部所有文字節點 + input.value
3. 匹配 sk-proj- pattern → 即時提交
4. 輔助：clipboard 攔截（使用者點 Copy 時）
```

**穩定選擇器**：
- `td.api-key-token .api-key-token-value` — 列表中截斷版
- `[data-state="open"]` — Radix modal 開啟狀態

---

#### Anthropic (`console.anthropic.com/settings/keys` / `platform.claude.com/settings/keys`)

**Key 格式**：`sk-ant-api03-[A-Za-z0-9_-]{80,}`

**DOM 結構**：
- 列表頁：`<code class="text-text-300">` 只有截斷版 `sk-ant-api03-V36...KgAA`
- 建立 Dialog：彈出命名對話框 → 顯示完整 key + Copy Key 按鈕
- 框架：React + Tailwind

**截取策略**：
```
1. MutationObserver 監聽 dialog/modal 元素出現
2. 掃描 dialog 內 <code> 元素和 input.value
3. 匹配 sk-ant-api03- pattern → 即時提交
4. 輔助：clipboard 攔截
```

**穩定選擇器**：
- `code` — key 通常在 code 元素中
- `[role="dialog"]` — 建立 key 的 dialog
- `.text-text-300` — Anthropic 自訂 Tailwind token（相對穩定）

---

#### AWS IAM (`console.aws.amazon.com/iam/`)

**Key 格式**：Access Key `AKIA[0-9A-Z]{16}` + Secret Key（40 字元 Base64）

**DOM 結構**：
- 多步驟 wizard，最後一頁顯示兩個 key
- Cloudscape UI 設計系統：`awsui-*` 前綴元件
- `CopyToClipboard` 元件包含 key 值
- "Download .csv file" 按鈕

**截取策略**：
```
1. 偵測 wizard 步驟變化（URL hash 或 DOM 結構變更）
2. 掃描 Cloudscape Input 元件的 value 和 CopyToClipboard 的 textContent
3. Access Key ID 用 AKIA pattern 匹配
4. Secret Key 較難（無固定前綴），依賴頁面上下文：
   - 與 AKIA key 同時出現在同一 wizard 步驟
   - 40 字元 Base64 格式
   - 相鄰元素含 "Secret access key" 文字
5. 兩個 key 逐一提交，Core 端依 sourceURL + 時間判斷為同批次
```

**穩定選擇器**：
- `[class*="awsui_input"]` — Cloudscape input（hash 後綴會變，用 contains）
- `[class*="awsui_copy"]` — Cloudscape CopyToClipboard

**特殊挑戰**：AWS Secret Key 無前綴，需上下文分析提升信心分數

---

#### GitHub (`github.com/settings/tokens`)

**Key 格式**：`ghp_[A-Za-z0-9]{36}` / `github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}`

**DOM 結構**：
- 建立後在 flash notice 容器中顯示：`<div class="flash flash-full">`
- Token 在 `<clipboard-copy value="ghp_xxxxx">` Web Component 中
- 明確警告文字：「You won't be able to see it again!」

**截取策略**：
```
1. MutationObserver 監聽 .flash 容器出現
2. 讀取 <clipboard-copy> 元素的 value attribute（不是 textContent）
3. 匹配 ghp_ 或 github_pat_ pattern → 即時提交
4. 輔助：TreeWalker 掃描 flash 內 <code> 元素
```

**穩定選擇器**：
- `clipboard-copy[value]` — 自訂 Web Component，非常穩定
- `.flash code` — flash notice 中的 code 元素

---

#### SendGrid (`app.sendgrid.com/settings/api_keys`)

**Key 格式**：`SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}`

**DOM 結構**：不明（未能直接檢視）

**截取策略**：
```
1. MutationObserver 監聽建立確認頁出現
2. TreeWalker 掃描匹配 SG. pattern
3. 輔助：clipboard 攔截
```

---

#### Stripe Live (`dashboard.stripe.com/apikeys`)

**Key 格式**：`sk_live_[a-zA-Z0-9]{24,}`

**DOM 結構**：React + CSS modules（hash class）

**截取策略**：
```
1. MutationObserver 監聯建立 key 後的 DOM 變化
2. 掃描 input[type="text"] 和 input[readonly] 的 value
3. 匹配 sk_live_ pattern → 即時提交
4. 輔助：clipboard 攔截
```

**注意**：CSS modules 的 hash class 不穩定，不可依賴

---

### Category B：可重複查看

#### Google Cloud (`console.cloud.google.com/apis/credentials`)

**Key 格式**：`AIzaSy[A-Za-z0-9_-]{33}`

**DOM 結構**：
- Angular + Material Design
- 自訂元素 `<services-show-api-key-string>`
- "Show key" 按鈕觸發顯示
- 建立時的 modal：`<mat-dialog-container>`

**截取策略**：
```
1. 監聽 <services-show-api-key-string> 元素內容變化
2. 偵測 "Show key" 按鈕點擊後出現的 key 文字
3. 建立 modal：掃描 mat-dialog-container 內容
4. 匹配 AIzaSy pattern → 提交
```

**穩定選擇器**：
- `services-show-api-key-string` — 自訂 Angular 元素名
- `mat-dialog-container` — Material dialog

---

#### Hugging Face (`huggingface.co/settings/tokens`)

**Key 格式**：`hf_[a-zA-Z0-9]{30,}`

**DOM 結構**：
- 列表頁：`<td>` 裸文字節點，只有截斷版 `hf_...DGlI`
- 建立新 token：導向 `/settings/tokens/new`，完成後顯示完整 token
- Svelte 框架 + Tailwind

**截取策略**：
```
1. 監聽 URL 從 /tokens/new 返回後的頁面變化
2. 掃描 flash/notice 容器中的完整 token
3. TreeWalker 匹配 hf_ pattern（長度 > 30 才算完整）
4. 過濾截斷版（含 ... 的不提交）
```

**過濾邏輯**：
```typescript
// 排除截斷版 token
if (rawValue.includes('...') || rawValue.length < 33) continue;
```

---

#### Slack (`api.slack.com/apps/*/oauth`)

**Key 格式**：`xoxb-[0-9]+-[A-Za-z0-9-]+` / `xoxp-...`

**DOM 結構**：Token 永遠可見在 OAuth 頁面

**截取策略**：
```
1. 頁面載入時直接 TreeWalker 掃描
2. 匹配 xox[bpae]- pattern → 提交
3. 無需 MutationObserver（token 不是動態出現）
```

---

#### Stripe Test (`dashboard.stripe.com/test/apikeys`)

**Key 格式**：`sk_test_[a-zA-Z0-9]{24,}`

**DOM 結構**：Reveal/Hide toggle 按鈕

**截取策略**：
```
1. MutationObserver 監聽 Reveal 按鈕點擊後的 DOM 變化
2. 掃描新出現的 sk_test_ pattern
3. 輔助：input[readonly].value 掃描
```

---

#### Vercel (`vercel.com/*/settings/environment-variables`)

**Key 格式**：各種（非固定前綴）

**截取策略**：
```
1. Eye icon 點擊後 MutationObserver 偵測明文出現
2. 用所有 CAPTURE_PATTERNS 比對
3. 信心分數較低（非專屬 domain → -0.1 penalty）
4. Sensitive 變數永不可見，不截取
```

---

## 實作架構（已完成）

### Single Source of Truth: capture-patterns.ts

所有平台定義集中在 `capture-patterns.ts`。新增平台只需加一個 entry：

```typescript
export interface CapturePattern {
    id: string;                        // 唯一識別
    serviceName: string;               // 服務名稱
    prefix: string;                    // Key 前綴
    regex: RegExp;                     // 偵測用 regex
    confidence: number;                // 基礎信心分數
    minLength: number;                 // 最短匹配長度
    preHideCSS?: string;              // document_start 注入的隱藏 CSS
    platformSelectors?: PlatformSelector[];  // 平台專屬 DOM 選擇器
}
```

### 新增平台範例

```typescript
// 在 CAPTURE_PATTERNS 陣列中加入一個 entry：
{
    id: 'vercel',
    serviceName: 'Vercel',
    prefix: 'vercel_',
    regex: /vercel_[a-zA-Z0-9]{24,}/g,
    confidence: 0.90,
    minLength: 31,
    preHideCSS: 'input[readonly] { visibility: hidden !important; }',
    platformSelectors: [{
        hostname: 'vercel.com',
        selectors: ['input[readonly]'],
        attributes: ['value'],
        strategy: 'reveal_toggle',
    }],
}
// 然後在 manifest.json 加 URL match，完成
```

### 自動衍生的功能

| 匯出 | 來源 | 用途 |
|------|------|------|
| `KEY_PREFIXES[]` | 自動從 CAPTURE_PATTERNS 提取 | pre-hide instant observer |
| `getPreHideCSS(hostname)` | 收集該 hostname 的 preHideCSS | document_start CSS 注入 |
| `getPlatformSelectors(hostname)` | 過濾 platformSelectors | 平台專屬 DOM 掃描 |
| `getWatchSelectors(hostname)` | 過濾 watchSelector | MutationObserver 監聽 |

### 四層偵測機制

| Layer | 名稱 | 說明 |
|-------|------|------|
| 1 | TreeWalker | 掃描所有文字節點（通用） |
| 2 | Attribute scan | 讀取 input.value、clipboard-copy[value]（通用） |
| 3 | Clipboard intercept | 監聽 copy 事件（通用） |
| 4 | Platform selectors | 平台專屬 CSS selector 定位 |

### Pre-hide 防閃現（兩層）

| Layer | 時機 | 方式 |
|-------|------|------|
| CSS pre-hide | document_start | 從 preHideCSS 欄位收集，`visibility: hidden` |
| Instant Observer | document_start | 只監聽 dialog/modal 內新增元素 |

---

## 測試結果

| 平台 | 截取 | 遮蔽 | Pre-hide | Toast | 存入 Core |
|------|------|------|----------|-------|----------|
| GitHub (Classic PAT) | ✅ | ✅ | ✅ | ✅ | ✅ |
| HuggingFace | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic/Claude | ✅ | ✅ | ✅ | ✅ | ✅ |
| 測試頁面 | ✅ | ✅ | — | ✅ | ✅ |
| OpenAI | ❓ 未測 | ❓ | ❓ | ❓ | ❓ |
| Stripe | ❓ 未測 | ❓ | ❓ | ❓ | ❓ |
| Google Cloud | ❓ 未測 | ❓ | ❓ | ❓ | ❓ |
| AWS | ❓ 未測 | ❓ | ❓ | ❓ | ❓ |
