# 遮蔽格式與 Pattern 參考

## 遮蔽核心原則

> 在展示模式下，API Key 明文**不得出現在任何顯示器的任何時刻**。這是硬性保證。

## 遮蔽格式規則

預設顯示格式**保留 Key 類型辨識度**，同時隱藏敏感部分：

| 服務 | 原始值 | 遮蔽顯示 | 說明 |
|------|--------|---------|------|
| OpenAI | `sk-proj-Abc12...xYz` | `sk-proj-****...****` | 保留前綴 |
| Anthropic | `sk-ant-api03-Abc...` | `sk-ant-****...****` | 保留前綴 |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | `AKIA****...****` | 保留前綴 |
| AWS Secret Key | `wJalrXUtnFEMI/K7MDENG` | `****...****` | **全遮蔽**（最高安全性） |
| Stripe | `sk_live_51Hb...` | `sk_live_****...****` | 保留前綴 |
| Google Cloud | `AIzaSyB1234...` | `AIza****...****` | 保留前綴 |
| GitHub PAT | `ghp_aBcD1234...` | `ghp_****...****` | 保留前綴 |
| Slack | `xoxb-1234-5678-abc` | `xoxb-****...****` | 保留前綴 |
| Azure | `a1b2c3d4e5f6...` | `****...****1234` | **全遮蔽 + 末 4 碼** |

### MaskFormat 結構

| 屬性 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `showPrefix` | Int | 依服務而異 | 顯示的前綴字元數 |
| `showSuffix` | Int | 0 或 4 | 顯示的後綴字元數 |
| `maskChar` | Character | `*` | 遮蔽字元 |
| `separator` | String | `...` | 前綴與後綴間的分隔字串 |

> 格式可依服務自訂。AWS Secret Key 使用全遮蔽（不顯示前綴）以確保最高安全性。

---

## 內建 Regex 樣式庫

### 核心 Pattern（MVP 內建）

| 服務 | Pattern | 範例前綴 | showPrefix | showSuffix |
|------|---------|---------|-----------|-----------|
| OpenAI | `sk-proj-[A-Za-z0-9_-]{20,}` | `sk-proj-` | 8 | 0 |
| Anthropic | `sk-ant-[A-Za-z0-9_-]{20,}` | `sk-ant-` | 7 | 0 |
| AWS Access Key | `AKIA[0-9A-Z]{16}` | `AKIA` | 4 | 0 |
| AWS Secret Key | `[A-Za-z0-9/+=]{40}` | (無固定前綴) | 0 | 0 |
| Stripe Live Secret | `sk_live_[A-Za-z0-9]{24,}` | `sk_live_` | 8 | 0 |
| Google Cloud API Key | `AIza[0-9A-Za-z_-]{35}` | `AIza` | 4 | 0 |
| GitHub PAT | `ghp_[A-Za-z0-9]{36}` | `ghp_` | 4 | 0 |

### 擴充 Pattern（Phase 2 內建）

| 服務 | Pattern | 範例前綴 | showPrefix | showSuffix |
|------|---------|---------|-----------|-----------|
| AWS Session Token | `ASIA[0-9A-Z]{16}` | `ASIA` | 4 | 0 |
| Stripe Live Publishable | `pk_live_[A-Za-z0-9]{24,}` | `pk_live_` | 8 | 0 |
| Stripe Test Secret | `sk_test_[A-Za-z0-9]{24,}` | `sk_test_` | 8 | 0 |
| Stripe Restricted | `rk_live_[A-Za-z0-9]{24,}` | `rk_live_` | 8 | 0 |
| GitHub Fine-grained PAT | `github_pat_[A-Za-z0-9_]{22,}` | `github_pat_` | 11 | 0 |
| GitHub OAuth Token | `gho_[A-Za-z0-9]{36}` | `gho_` | 4 | 0 |
| GitLab PAT | `glpat-[A-Za-z0-9_-]{20,}` | `glpat-` | 6 | 0 |
| Azure Subscription Key | `[0-9a-f]{32}` | (無固定前綴) | 0 | 4 |
| Azure AD Client Secret | `[A-Za-z0-9_~.-]{34,}` | (無固定前綴) | 0 | 4 |
| Slack Bot Token | `xoxb-[0-9A-Za-z-]{24,}` | `xoxb-` | 5 | 0 |
| Slack User Token | `xoxp-[0-9A-Za-z-]{24,}` | `xoxp-` | 5 | 0 |
| Twilio Auth Token | `[0-9a-f]{32}` | (無固定前綴) | 0 | 4 |
| SendGrid API Key | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | `SG.` | 3 | 0 |
| Hugging Face Token | `hf_[A-Za-z0-9]{34,}` | `hf_` | 3 | 0 |

> 使用者可透過設定新增自訂 pattern，以涵蓋專有或較不常見的服務。
> Phase 2 目標涵蓋 50+ 已知服務。上表為優先實作的高頻率服務。

### Pattern 匹配注意事項

| 項目 | 說明 |
|------|------|
| AWS Secret Key | 無固定前綴，僅靠長度 + 字元集匹配，信心分數較低（~0.6），需使用者確認 |
| Azure 系列 | 無固定前綴，依賴頁面 URL 或上下文提升信心分數 |
| 衝突處理 | 多個 pattern 匹配同一文字時，取最長匹配（最具體的 pattern 優先） |
| 自訂 pattern 驗證 | 新增時即時編譯測試，拒絕無效 regex 或可能造成 ReDoS 的回溯模式 |

---

## 遮蔽層級

### Layer 1: VS Code Extension（MVP）

- 監聽開啟的文件，使用 regex 庫偵測已知 Key 樣式
- 使用 VS Code **Decoration API** 在偵測到的 Key 上渲染遮蔽覆蓋層
- Gutter 顯示鎖圖示（🔒）標記包含遮蔽 Key 的行
- 游標懸停顯示提示：`[Demo-safe] sk-proj-****...****`
- **展示模式下無揭示選項**——與 Password Manager 模式一致

### Layer 2: Chrome Extension（Phase 2）

- Content scripts 注入已知 API 主控台頁面（OpenAI、AWS、Stripe、GCP、Azure 等）
- 自動偵測頁面上的 Key 元素並套用 CSS 覆蓋 / 文字替換
- 擷取 Key 並透過 native messaging 傳送至核心引擎
- 樣式庫於發佈時涵蓋 **50+ 已知服務**

### Layer 3: 系統級 Accessibility API（Phase 3）

- 使用 macOS `AXUIElement` API 系統級攔截文字渲染
- 覆蓋終端、所有編輯器、所有應用程式、所有顯示器
- 即使 OBS 螢幕擷取也僅顯示遮蔽版本
- 需要授予 Accessibility 權限（引導式初始設定流程）

---

## 智慧偵測：DetectedKey 結構

當 `ClipboardEngine.detectKeysInClipboard()` 或 Extension 偵測到金鑰時，產生：

| 屬性 | 說明 |
|------|------|
| `rawValue` | 偵測到的原始值 |
| `suggestedService` | 根據 pattern 建議的服務 |
| `pattern` | 匹配到的 regex |
| `confidence` | 信心分數，用於使用者驗證 |
