# API Key 部署與輪替最佳實踐

> 狀態：❌ 功能尚未實作
> 目標：提供一鍵快速更換系統中已部署 API Key 的功能

---

## 概述

Demo-safe 未來可整合各家 SaaS 的 Key 管理 API，實現「在 Demo-safe 中輪替 Key → 自動更新所有已部署位置」的工作流程。本文件記錄各平台的 Key 管理最佳實踐與 API 接口。

---

## 各平台環境變數與 SDK 慣例

| 平台 | 環境變數名稱 | SDK 自動讀取 |
|------|-------------|-------------|
| OpenAI | `OPENAI_API_KEY` | Python / Node SDK 自動讀取 |
| Anthropic | `ANTHROPIC_API_KEY` | Python / TS SDK 自動讀取 |
| AWS | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | SDK credential chain |
| Google Cloud | `GOOGLE_APPLICATION_CREDENTIALS`（JSON 檔案路徑） | ADC 自動讀取 |
| Stripe | `STRIPE_SECRET_KEY`（慣例，SDK 不自動讀取） | 需明確初始化 |
| GitHub | `GITHUB_TOKEN` / `GH_TOKEN` | Actions / gh CLI 讀取 |
| Azure | `AZURE_KEY_VAULT_URL` + `DefaultAzureCredential` | SDK credential chain |

---

## 各平台 Key 輪替方式

### OpenAI

- **管理介面**：https://platform.openai.com/settings/organization/api-keys
- **輪替方式**：手動 — 產生新 Key → 更新部署 → 刪除舊 Key
- **自動輪替**：不支援，無公開 Key 管理 API
- **建議**：使用 Project API Keys 限制範圍；`.env` 搭配 `python-dotenv`

### Anthropic

- **管理介面**：https://console.anthropic.com/settings/keys
- **Header**：`x-api-key: $ANTHROPIC_API_KEY`
- **輪替方式**：手動 — 同 OpenAI 流程
- **自動輪替**：不支援

### AWS

**IAM Access Keys**：
```bash
# 建立新 Key
aws iam create-access-key --user-name <USER>
# 停用舊 Key
aws iam update-access-key --access-key-id <OLD_KEY> --status Inactive --user-name <USER>
# 刪除舊 Key
aws iam delete-access-key --access-key-id <OLD_KEY> --user-name <USER>
```

**AWS Secrets Manager**（推薦）：
```bash
aws secretsmanager create-secret --name MySecret --secret-string '{"key":"value"}'
aws secretsmanager rotate-secret --secret-id MySecret
aws secretsmanager get-secret-value --secret-id MySecret
```

- **自動輪替**：支援（Lambda 函數或 managed rotation）
- **輪替策略**：Single-user（原地更新）或 Alternating-user（雙用戶零停機）
- **最佳實踐**：用 IAM Roles / STS 臨時憑證取代長期 Access Keys

### Google Cloud

```bash
# 建立新 Key
gcloud iam service-accounts keys create key.json \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
# 列出 Keys
gcloud iam service-accounts keys list \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
# 刪除舊 Key
gcloud iam service-accounts keys delete KEY_ID \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
```

- **自動輪替**：不支援 Service Account Keys
- **最佳實踐**：Google 強烈建議完全避免使用 SA Keys，改用 Workload Identity Federation 或 attached service accounts

### Stripe

- **Key 類型**：Standard (`sk_live_`)、Restricted (`rk_live_`，限定 API 資源)、Publishable (`pk_live_`)
- **Roll 功能**：Dashboard 支援「滾動更新」— 產生新 Key，舊 Key 在設定的寬限期後過期
- **自動輪替**：部分支援（Roll 功能提供寬限期管理）
- **最佳實踐**：使用 Restricted Keys 限制爆炸半徑；設定 IP 白名單

### GitHub

- **推薦**：Fine-grained PATs（限定 repo、限定權限）
- **更佳方案**：GitHub Apps（使用短期 installation tokens，自動 1 小時過期）
- **自動輪替**：不支援 PATs；Organizations 可強制最大有效期
- **CLI**：
```bash
gh auth token       # 查看當前 token
gh auth login       # 新 token 認證
gh auth refresh     # 刷新認證
```

### Azure Key Vault

```bash
az keyvault secret set --vault-name <VAULT> --name <SECRET> --value <VALUE>
az keyvault secret show --vault-name <VAULT> --name <SECRET>
```

- **自動輪替**：完全支援 — 內建 autorotation policies
- **認證**：`DefaultAzureCredential`（Managed Identity → 環境變數 → CLI）
- **最佳實踐**：每個 app/region/環境一個 Key Vault；啟用 soft-delete 和 purge protection

---

## 部署平台環境變數管理

### Vercel

```bash
vercel env add <NAME> [environment]    # 新增（可指定 Production/Preview/Development）
vercel env pull                         # 下載 dev 環境變數到 .env
vercel env ls                           # 列出
vercel env rm <NAME> [environment]      # 移除
```

### Railway

- **變數類型**：Service 變數、Shared 變數（跨 service）、Reference 變數（模板）
- **Reference 語法**：`${{ shared.VAR }}`、`${{ SERVICE_NAME.VAR }}`
- **Sealed 變數**：加密後不可再查看，只能重設
- **CLI**：`railway run <cmd>` 注入環境變數

### Fly.io

```bash
fly secrets set KEY=VALUE              # 設定（自動重新部署）
fly secrets set KEY=VALUE --stage      # 暫存不重新部署
fly secrets list                       # 列出（只顯示名稱）
fly secrets unset KEY                  # 移除
```

---

## Secret Management 工具

### HashiCorp Vault — 動態憑證

```bash
vault read database/creds/readonly     # 產生臨時 DB 憑證
vault lease renew <lease_id>           # 延長租約
vault lease revoke <lease_id>          # 撤銷憑證
vault lease revoke -prefix aws/        # 撤銷所有 AWS 憑證（事故回應）
```

- **核心概念**：動態 secrets — 每次請求產生唯一短期憑證，TTL 到期自動撤銷
- **優勢**：完全消除輪替問題（憑證本身就是臨時的）

### Doppler

```bash
doppler setup                          # 初始化專案
doppler run -- <cmd>                   # 注入 secrets 並執行
doppler secrets set KEY=VALUE          # 設定
```

- **自動輪替**：支援 DB 憑證和 AWS IAM 動態 secrets
- **整合**：40+ 平台自動同步（AWS SM、Azure KV、Vercel、Cloudflare 等）

### Infisical

```bash
infisical run -- <cmd>                 # 注入 secrets 執行
infisical secrets                      # 管理 secrets
```

- **部署**：雲端或自架
- **重點**：解決 secret sprawl（憑證散落在程式碼和 CI/CD 各處）

### 1Password Connect Server

- **架構**：自架 REST API 伺服器，快取 1Password vault 中的 secrets
- **SDK**：Go、Python、JavaScript
- **CLI**：`op run -- <cmd>` 注入 secrets

---

## .env 檔案最佳實踐

| 規則 | 說明 |
|------|------|
| 永不 commit `.env` | 加入 `.gitignore` |
| 提供 `.env.example` | 含 placeholder 值，commit 作為文件 |
| 分環境檔案 | `.env.development`、`.env.production` |
| 加密共享 | 需共享時用 `git-crypt`、`sops`、`age` 加密 |
| 使用 `direnv` | 目錄級自動載入/卸載，需 `direnv allow` 明確授權 |

---

## 零停機輪替模式

### 雙 Key / 寬限期模式

```
1. 產生新 Key (Key B)，舊 Key (Key A) 仍有效
2. 部署 Key B 到所有消費端
3. 確認所有消費端使用 Key B 後，撤銷 Key A
```

Stripe 的 Roll 功能自動實現此模式。

### 雙用戶交替模式（AWS Secrets Manager）

```
1. 維護兩個 DB 用戶 (userA / userB)
2. 輪替時更新「非活躍」用戶的密碼
3. 切換「當前」指標到新用戶
4. 舊連線自然關閉後完全遷移
```

### 動態臨時憑證（HashiCorp Vault）

```
不需要輪替 — 每個消費端取得獨立的短期憑證
TTL 到期自動撤銷
從根本上消除輪替問題
```

---

## 自動輪替支援總覽

| 平台 | 自動輪替 | 方式 |
|------|---------|------|
| AWS Secrets Manager | ✅ | Lambda 或 managed rotation |
| Azure Key Vault | ✅ | 內建 autorotation policies |
| HashiCorp Vault | ✅ | 動態臨時憑證 + TTL |
| Doppler | ✅ | 動態 secrets、DB rotation |
| Google Cloud (SA Keys) | ❌ | 需自行 script 或避免使用 |
| OpenAI | ❌ | 手動 Dashboard |
| Anthropic | ❌ | 手動 Console |
| Stripe | 🔶 | Roll 功能 + 寬限期 |
| GitHub | ❌ | 手動；Apps 使用自動過期 token |

---

## Demo-safe 整合方向

未來 Demo-safe 可提供以下功能：

1. **一鍵輪替**：在 Demo-safe 中觸發 Key 輪替 → 呼叫對應平台 API 產生新 Key → 自動更新 Vault
2. **部署同步**：輪替後自動推送到 Vercel / Railway / Fly.io 等部署平台的環境變數
3. **Secret Manager 整合**：支援從 AWS SM / Azure KV / Doppler 拉取 Key，取代手動輸入
4. **輪替提醒**：追蹤 Key 建立日期，依策略提醒使用者輪替
5. **雙 Key 寬限期**：輪替時維持新舊 Key 同時有效，確認部署完成後再撤銷舊 Key
