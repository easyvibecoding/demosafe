# Masking Format and Pattern Reference

## Core Masking Principle

> In Demo Mode, API Key plaintext **must not appear on any display at any time**. This is a hard guarantee.

## Masking Format Rules

The default display format **preserves Key type recognizability** while hiding the sensitive portion:

| Service | Original Value | Masked Display | Description |
|---------|---------------|---------------|-------------|
| OpenAI | `sk-proj-Abc12...xYz` | `sk-proj-****...****` | Prefix preserved |
| Anthropic | `sk-ant-api03-Abc...` | `sk-ant-****...****` | Prefix preserved |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | `AKIA****...****` | Prefix preserved |
| AWS Secret Key | `wJalrXUtnFEMI/K7MDENG` | `****...****` | **Fully masked** (highest security) |
| Stripe | `sk_live_51Hb...` | `sk_live_****...****` | Prefix preserved |
| Google Cloud | `AIzaSyB1234...` | `AIza****...****` | Prefix preserved |
| GitHub PAT | `ghp_aBcD1234...` | `ghp_****...****` | Prefix preserved |
| Slack | `xoxb-1234-5678-abc` | `xoxb-****...****` | Prefix preserved |
| Azure | `a1b2c3d4e5f6...` | `****...****1234` | **Fully masked + last 4 characters** |

### MaskFormat Structure

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `showPrefix` | Int | Varies by service | Number of prefix characters to display |
| `showSuffix` | Int | 0 or 4 | Number of suffix characters to display |
| `maskChar` | Character | `*` | Masking character |
| `separator` | String | `...` | Separator string between prefix and suffix |

> Format is customizable per service. AWS Secret Key uses full masking (no prefix shown) to ensure the highest level of security.

---

## Built-in Regex Pattern Library

### Core Patterns (Built into MVP)

| Service | Pattern | Example Prefix | showPrefix | showSuffix |
|---------|---------|---------------|-----------|-----------|
| OpenAI | `sk-proj-[A-Za-z0-9_-]{20,}` | `sk-proj-` | 8 | 0 |
| Anthropic | `sk-ant-[A-Za-z0-9_-]{20,}` | `sk-ant-` | 7 | 0 |
| AWS Access Key | `AKIA[0-9A-Z]{16}` | `AKIA` | 4 | 0 |
| AWS Secret Key | `[A-Za-z0-9/+=]{40}` | (no fixed prefix) | 0 | 0 |
| Stripe Live Secret | `sk_live_[A-Za-z0-9]{24,}` | `sk_live_` | 8 | 0 |
| Google Cloud API Key | `AIza[0-9A-Za-z_-]{35}` | `AIza` | 4 | 0 |
| GitHub PAT | `ghp_[A-Za-z0-9]{36}` | `ghp_` | 4 | 0 |

### Extended Patterns (Built into Phase 2)

| Service | Pattern | Example Prefix | showPrefix | showSuffix |
|---------|---------|---------------|-----------|-----------|
| AWS Session Token | `ASIA[0-9A-Z]{16}` | `ASIA` | 4 | 0 |
| Stripe Live Publishable | `pk_live_[A-Za-z0-9]{24,}` | `pk_live_` | 8 | 0 |
| Stripe Test Secret | `sk_test_[A-Za-z0-9]{24,}` | `sk_test_` | 8 | 0 |
| Stripe Restricted | `rk_live_[A-Za-z0-9]{24,}` | `rk_live_` | 8 | 0 |
| GitHub Fine-grained PAT | `github_pat_[A-Za-z0-9_]{22,}` | `github_pat_` | 11 | 0 |
| GitHub OAuth Token | `gho_[A-Za-z0-9]{36}` | `gho_` | 4 | 0 |
| GitLab PAT | `glpat-[A-Za-z0-9_-]{20,}` | `glpat-` | 6 | 0 |
| Azure Subscription Key | `[0-9a-f]{32}` | (no fixed prefix) | 0 | 4 |
| Azure AD Client Secret | `[A-Za-z0-9_~.-]{34,}` | (no fixed prefix) | 0 | 4 |
| Slack Bot Token | `xoxb-[0-9A-Za-z-]{24,}` | `xoxb-` | 5 | 0 |
| Slack User Token | `xoxp-[0-9A-Za-z-]{24,}` | `xoxp-` | 5 | 0 |
| Twilio Auth Token | `[0-9a-f]{32}` | (no fixed prefix) | 0 | 4 |
| SendGrid API Key | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | `SG.` | 3 | 0 |
| Hugging Face Token | `hf_[A-Za-z0-9]{34,}` | `hf_` | 3 | 0 |

> Users can add custom patterns through settings to cover proprietary or less common services.
> Phase 2 targets coverage of 50+ known services. The table above lists the high-frequency services prioritized for implementation.

### Pattern Matching Notes

| Item | Description |
|------|-------------|
| AWS Secret Key | No fixed prefix; relies only on length + character set matching; lower confidence score (~0.6); requires user confirmation |
| Azure series | No fixed prefix; depends on page URL or context to boost confidence score |
| Conflict handling | When multiple patterns match the same text, the longest match wins (most specific pattern takes priority) |
| Custom pattern validation | Compiled and tested in real-time when added; rejects invalid regex or backtracking patterns that could cause ReDoS |

---

## Masking Layers

### Layer 1: VS Code Extension (MVP)

- Monitors open documents, using the regex library to detect known Key patterns
- Uses VS Code **Decoration API** to render masking overlays on detected Keys
- Gutter displays a lock icon (🔒) marking lines containing masked Keys
- Cursor hover shows tooltip: `[Demo-safe] sk-proj-****...****`
- **No reveal option in Demo Mode** — consistent with Password Manager behavior

### Layer 2: Chrome Extension (Phase 2)

- Content scripts injected into known API console pages (OpenAI, AWS, Stripe, GCP, Azure, etc.)
- Automatically detects Key elements on the page and applies CSS overlay / text replacement
- Extracts Keys and sends them to the core engine via native messaging
- Pattern library covers **50+ known services** at release

### Layer 3: System-Level Accessibility API (Phase 3)

- Uses macOS `AXUIElement` API for system-level text rendering interception
- Covers terminals, all editors, all applications, all displays
- Even OBS screen capture shows only the masked version
- Requires granting Accessibility permission (guided initial setup flow)

---

## Smart Detection: DetectedKey Structure

When `ClipboardEngine.detectKeysInClipboard()` or an Extension detects a key, it produces:

| Property | Description |
|----------|-------------|
| `rawValue` | Detected raw value |
| `suggestedService` | Suggested service based on pattern |
| `pattern` | Matched regex |
| `confidence` | Confidence score, used for user verification |
