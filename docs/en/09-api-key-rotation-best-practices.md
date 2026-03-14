# API Key Deployment & Rotation Best Practices

> Status: Feature not yet implemented
> Goal: Provide one-click quick replacement of deployed API Keys across the system

---

## Overview

Demo-safe can integrate with various SaaS Key management APIs in the future, enabling a workflow of "rotate Key in Demo-safe -> automatically update all deployed locations." This document records the Key management best practices and API interfaces for each platform.

---

## Platform Environment Variables & SDK Conventions

| Platform | Environment Variable | SDK Auto-Read |
|----------|---------------------|---------------|
| OpenAI | `OPENAI_API_KEY` | Python / Node SDK auto-reads |
| Anthropic | `ANTHROPIC_API_KEY` | Python / TS SDK auto-reads |
| AWS | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | SDK credential chain |
| Google Cloud | `GOOGLE_APPLICATION_CREDENTIALS` (JSON file path) | ADC auto-reads |
| Stripe | `STRIPE_SECRET_KEY` (convention, SDK does not auto-read) | Requires explicit initialization |
| GitHub | `GITHUB_TOKEN` / `GH_TOKEN` | Actions / gh CLI reads |
| Azure | `AZURE_KEY_VAULT_URL` + `DefaultAzureCredential` | SDK credential chain |

---

## Key Rotation Methods by Platform

### OpenAI

- **Management Console**: https://platform.openai.com/settings/organization/api-keys
- **Rotation Method**: Manual -- generate new Key -> update deployments -> delete old Key
- **Auto-rotation**: Not supported, no public Key management API
- **Recommendation**: Use Project API Keys to limit scope; `.env` with `python-dotenv`

### Anthropic

- **Management Console**: https://console.anthropic.com/settings/keys
- **Header**: `x-api-key: $ANTHROPIC_API_KEY`
- **Rotation Method**: Manual -- same as OpenAI flow
- **Auto-rotation**: Not supported

### AWS

**IAM Access Keys**:
```bash
# Create new Key
aws iam create-access-key --user-name <USER>
# Deactivate old Key
aws iam update-access-key --access-key-id <OLD_KEY> --status Inactive --user-name <USER>
# Delete old Key
aws iam delete-access-key --access-key-id <OLD_KEY> --user-name <USER>
```

**AWS Secrets Manager** (Recommended):
```bash
aws secretsmanager create-secret --name MySecret --secret-string '{"key":"value"}'
aws secretsmanager rotate-secret --secret-id MySecret
aws secretsmanager get-secret-value --secret-id MySecret
```

- **Auto-rotation**: Supported (Lambda functions or managed rotation)
- **Rotation Strategies**: Single-user (in-place update) or Alternating-user (dual-user zero-downtime)
- **Best Practice**: Use IAM Roles / STS temporary credentials instead of long-term Access Keys

### Google Cloud

```bash
# Create new Key
gcloud iam service-accounts keys create key.json \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
# List Keys
gcloud iam service-accounts keys list \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
# Delete old Key
gcloud iam service-accounts keys delete KEY_ID \
  --iam-account=SA@PROJECT.iam.gserviceaccount.com
```

- **Auto-rotation**: Not supported for Service Account Keys
- **Best Practice**: Google strongly recommends avoiding SA Keys entirely; use Workload Identity Federation or attached service accounts instead

### Stripe

- **Key Types**: Standard (`sk_live_`), Restricted (`rk_live_`, limited to specific API resources), Publishable (`pk_live_`)
- **Roll Feature**: Dashboard supports "rolling update" -- generates new Key, old Key expires after a configured grace period
- **Auto-rotation**: Partially supported (Roll feature provides grace period management)
- **Best Practice**: Use Restricted Keys to limit blast radius; configure IP allowlists

### GitHub

- **Recommended**: Fine-grained PATs (scoped to specific repos and permissions)
- **Better Option**: GitHub Apps (use short-lived installation tokens, auto-expire after 1 hour)
- **Auto-rotation**: Not supported for PATs; Organizations can enforce maximum validity periods
- **CLI**:
```bash
gh auth token       # View current token
gh auth login       # Authenticate with new token
gh auth refresh     # Refresh authentication
```

### Azure Key Vault

```bash
az keyvault secret set --vault-name <VAULT> --name <SECRET> --value <VALUE>
az keyvault secret show --vault-name <VAULT> --name <SECRET>
```

- **Auto-rotation**: Fully supported -- built-in autorotation policies
- **Authentication**: `DefaultAzureCredential` (Managed Identity -> Environment Variables -> CLI)
- **Best Practice**: One Key Vault per app/region/environment; enable soft-delete and purge protection

---

## Deployment Platform Environment Variable Management

### Vercel

```bash
vercel env add <NAME> [environment]    # Add (can specify Production/Preview/Development)
vercel env pull                         # Download dev environment variables to .env
vercel env ls                           # List
vercel env rm <NAME> [environment]      # Remove
```

### Railway

- **Variable Types**: Service variables, Shared variables (cross-service), Reference variables (templates)
- **Reference Syntax**: `${{ shared.VAR }}`, `${{ SERVICE_NAME.VAR }}`
- **Sealed Variables**: Encrypted and no longer viewable after sealing, can only be reset
- **CLI**: `railway run <cmd>` injects environment variables

### Fly.io

```bash
fly secrets set KEY=VALUE              # Set (auto-redeploys)
fly secrets set KEY=VALUE --stage      # Stage without redeploying
fly secrets list                       # List (shows names only)
fly secrets unset KEY                  # Remove
```

---

## Secret Management Tools

### HashiCorp Vault -- Dynamic Credentials

```bash
vault read database/creds/readonly     # Generate temporary DB credentials
vault lease renew <lease_id>           # Extend lease
vault lease revoke <lease_id>          # Revoke credentials
vault lease revoke -prefix aws/        # Revoke all AWS credentials (incident response)
```

- **Core Concept**: Dynamic secrets -- generates unique short-lived credentials per request, automatically revoked at TTL expiration
- **Advantage**: Completely eliminates the rotation problem (credentials are inherently temporary)

### Doppler

```bash
doppler setup                          # Initialize project
doppler run -- <cmd>                   # Inject secrets and execute
doppler secrets set KEY=VALUE          # Set
```

- **Auto-rotation**: Supports DB credentials and AWS IAM dynamic secrets
- **Integrations**: 40+ platforms with automatic sync (AWS SM, Azure KV, Vercel, Cloudflare, etc.)

### Infisical

```bash
infisical run -- <cmd>                 # Inject secrets and execute
infisical secrets                      # Manage secrets
```

- **Deployment**: Cloud or self-hosted
- **Focus**: Solving secret sprawl (credentials scattered across code and CI/CD pipelines)

### 1Password Connect Server

- **Architecture**: Self-hosted REST API server that caches secrets from 1Password vaults
- **SDKs**: Go, Python, JavaScript
- **CLI**: `op run -- <cmd>` injects secrets

---

## .env File Best Practices

| Rule | Description |
|------|-------------|
| Never commit `.env` | Add to `.gitignore` |
| Provide `.env.example` | With placeholder values, commit as documentation |
| Separate environment files | `.env.development`, `.env.production` |
| Encrypt for sharing | When sharing is needed, encrypt with `git-crypt`, `sops`, or `age` |
| Use `direnv` | Directory-level auto-load/unload, requires explicit `direnv allow` authorization |

---

## Zero-Downtime Rotation Patterns

### Dual Key / Grace Period Pattern

```
1. Generate new Key (Key B), old Key (Key A) remains valid
2. Deploy Key B to all consumers
3. After confirming all consumers use Key B, revoke Key A
```

Stripe's Roll feature automatically implements this pattern.

### Alternating User Pattern (AWS Secrets Manager)

```
1. Maintain two DB users (userA / userB)
2. On rotation, update the "inactive" user's password
3. Switch the "current" pointer to the new user
4. After old connections naturally close, migration is complete
```

### Dynamic Temporary Credentials (HashiCorp Vault)

```
No rotation needed -- each consumer gets independent short-lived credentials
TTL expiration triggers automatic revocation
Fundamentally eliminates the rotation problem
```

---

## Auto-Rotation Support Overview

| Platform | Auto-Rotation | Method |
|----------|--------------|--------|
| AWS Secrets Manager | Yes | Lambda or managed rotation |
| Azure Key Vault | Yes | Built-in autorotation policies |
| HashiCorp Vault | Yes | Dynamic temporary credentials + TTL |
| Doppler | Yes | Dynamic secrets, DB rotation |
| Google Cloud (SA Keys) | No | Requires custom scripting or avoidance |
| OpenAI | No | Manual Dashboard |
| Anthropic | No | Manual Console |
| Stripe | Partial | Roll feature + grace period |
| GitHub | No | Manual; Apps use auto-expiring tokens |

---

## Demo-safe Integration Direction

Demo-safe can provide the following features in the future:

1. **One-click Rotation**: Trigger Key rotation in Demo-safe -> call corresponding platform API to generate new Key -> automatically update Vault
2. **Deployment Sync**: After rotation, automatically push to environment variables on deployment platforms like Vercel / Railway / Fly.io
3. **Secret Manager Integration**: Support pulling Keys from AWS SM / Azure KV / Doppler, replacing manual input
4. **Rotation Reminders**: Track Key creation dates and remind users to rotate based on policy
5. **Dual Key Grace Period**: Keep both old and new Keys valid during rotation, revoke the old Key only after confirming deployment completion
