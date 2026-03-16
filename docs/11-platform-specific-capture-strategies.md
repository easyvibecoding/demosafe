# 各平台 API Key 截取策略

> 狀態：❌ 尚未實作（platform-specific 部分）
> 基礎設施（通用 TreeWalker + capture-patterns.ts）已完成

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

## 實作架構

### capture-patterns.ts 擴展

```typescript
export interface CapturePattern {
    id: string;
    serviceName: string;
    prefix: string;
    regex: RegExp;
    confidence: number;
    minLength: number;
    // 新增：平台專屬選擇器
    platformSelectors?: PlatformSelector[];
}

export interface PlatformSelector {
    hostname: string;          // 匹配的 domain
    selectors: string[];       // CSS selectors
    attributes?: string[];     // 要讀取的 attribute（如 value）
    watchSelector?: string;    // MutationObserver 監聽的容器
    strategy: 'modal_watch' | 'attribute_read' | 'flash_notice' | 'reveal_toggle';
}
```

### masker.ts 擴展

```typescript
function scanForNewKeys() {
    // 1. 通用 TreeWalker（現有）
    // 2. 通用 attribute scan（現有）
    // 3. 平台專屬 selector scan（新增）
    scanPlatformSpecific(hostname, allMatches);
}

function scanPlatformSpecific(hostname: string, matches: CaptureMatch[]) {
    for (const pattern of CAPTURE_PATTERNS) {
        if (!pattern.platformSelectors) continue;
        for (const ps of pattern.platformSelectors) {
            if (ps.hostname !== hostname) continue;
            for (const selector of ps.selectors) {
                const elements = document.querySelectorAll(selector);
                // 讀取 textContent 或指定 attribute
                // 匹配 pattern.regex
                // 加入 matches
            }
        }
    }
}
```

### MutationObserver 平台專屬監聽

```typescript
// 針對一次性 modal/dialog 的即時監聽
function startPlatformWatcher(hostname: string) {
    const patterns = CAPTURE_PATTERNS.filter(p =>
        p.platformSelectors?.some(ps =>
            ps.hostname === hostname && ps.watchSelector
        )
    );
    if (patterns.length === 0) return;

    // 建立專屬 MutationObserver 監聽 modal 出現
    const watcher = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const el = node as Element;
                // 檢查是否匹配 watchSelector
                // 如果是 → 立即掃描 modal 內容
            }
        }
    });
    watcher.observe(document.body, { childList: true, subtree: true });
}
```

---

## 實作順序

1. 擴展 `CapturePattern` 介面加入 `platformSelectors`
2. 為每個平台定義 selectors + strategy
3. `masker.ts` 加入 `scanPlatformSpecific()` 函數
4. `masker.ts` 加入 `startPlatformWatcher()` for modal 監聽
5. 加入截斷版過濾邏輯（排除 `...` 和過短的值）
6. 逐平台測試

## 測試計畫

| 平台 | 測試方式 | 預期結果 |
|------|---------|---------|
| OpenAI | 建立新 key → modal 出現 | 即時截取完整 key |
| Anthropic | 建立新 key → dialog 出現 | 即時截取完整 key |
| GitHub | 建立新 PAT → flash notice | 從 clipboard-copy[value] 截取 |
| Google Cloud | 點 "Show key" | 截取顯示的 key |
| HuggingFace | 建立新 token | 截取完整 token，忽略截斷版 |
| Stripe | Reveal test key | 截取顯示的 key |
| 測試頁面 | 靜態 + 動態 key | 所有 pattern 偵測 + MutationObserver |
