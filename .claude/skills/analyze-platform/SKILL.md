---
name: analyze-platform
description: "Analyze API key platform pages to maintain capture-patterns.ts. Use when a platform's UI changes, when adding support for a new platform, or when verifying that existing DOM selectors still work. Invoke with a platform name like '/analyze-platform openai' or '/analyze-platform huggingface'. Also use when someone says 'check if OpenAI changed their key page', 'update selectors for GitHub', 'add Vercel support', or 'verify platform selectors'."
user-invocable: true
---

# Platform DOM Analyzer for DemoSafe

Analyze an API key management page's DOM structure and compare it against the current selectors in `capture-patterns.ts`. This helps maintain the Chrome Extension's key detection and pre-hide capabilities as platforms update their UIs.

## Arguments

`$ARGUMENTS` should be a platform name or URL.

Platform shortcuts (case-insensitive):

| Name | URL |
|------|-----|
| openai | https://platform.openai.com/api-keys |
| anthropic | https://platform.claude.com/settings/keys |
| github | https://github.com/settings/tokens |
| google-cloud | https://console.cloud.google.com/apis/credentials |
| gemini / ai-studio | https://aistudio.google.com/apikey |
| stripe | https://dashboard.stripe.com/apikeys |
| aws | https://console.aws.amazon.com/iam/home#/security_credentials |
| huggingface | https://huggingface.co/settings/tokens |
| slack | https://api.slack.com/apps |
| sendgrid | https://app.sendgrid.com/settings/api_keys |
| gitlab | https://gitlab.com/-/user_settings/personal_access_tokens |

If the argument is a full URL, use it directly.

## Workflow

### 1. Prepare

- Read the analysis script from `scripts/platform-analysis/analyze-dom.js`
- Read the current platform entry from `packages/chrome-extension/src/content-scripts/capture-patterns.ts` — find the `CAPTURE_PATTERNS` entry matching the platform and note its current `platformSelectors`, `preHideCSS`, and `regex`
- Resolve the platform name to a URL using the table above

### 2. Navigate and Analyze

- Use `mcp__claude-in-chrome__tabs_context_mcp` to get available tabs
- Create a new tab or use an existing one
- Navigate to the platform URL with `mcp__claude-in-chrome__navigate`
- Wait 3 seconds for the page to load
- Execute the `analyze-dom.js` script on the page via `mcp__claude-in-chrome__javascript_tool`
- Parse the JSON output

### 3. SPA Framework Detection

Many platforms use React, Vue, or Angular. SPA frameworks cause specific issues:

- **React controls `input.value`** — direct `.value` replacement gets overwritten on re-render. The masker must keep dialog inputs hidden via manifest CSS rather than replacing their value.
- **SPA navigation** — pages like OpenAI/GitLab don't do full reloads when navigating between list and create views. Manifest CSS persists but MutationObserver must detect new dialogs.
- **Dynamic class names** — obfuscated classes (e.g., `EzGXF`, `htOZM`) change on every build. Never use these in selectors. Target stable attributes: `role`, `data-state`, `data-testid`, `type`, `aria-label`, semantic tags.

Detect the framework by checking:
```javascript
({
  react: !!document.querySelector('[data-reactroot], [data-react-helmet]') || !!Object.keys(document.querySelector('#__next') || {})[0],
  vue: !!document.querySelector('[data-v-], #__nuxt') || !!window.__VUE__,
  angular: !!document.querySelector('[ng-version], [_nghost]'),
  svelte: !!document.querySelector('[class*="svelte-"]'),
  webComponents: document.querySelectorAll('*').length !== document.querySelectorAll(':not(:defined)').length,
})
```

### 4. Analyze List Page vs Dialog

Platforms typically have two views:

**List page** — shows existing keys (usually truncated/masked by the platform)
- Check if list shows full keys or truncated (`sk-...xxxx`)
- Check `td`, `tr`, table structures for key display elements
- These selectors go in `platformSelectors[].selectors` for passive masking

**Create/reveal dialog** — shows the full key once (then never again)
- Check the dialog container: `[role="dialog"]`, `[data-state="open"]`, `.modal`, `.gl-alert`
- Check what element holds the key: `input[type="text"]`, `code`, `<p class="font-mono">`, `<clipboard-copy>`
- Check if key is in `input.value` (not a text node) — if so, note that React may overwrite replacements
- Check the Copy button: `button[aria-label="Copy"]`, `clipboard-copy[value]`, `navigator.clipboard.writeText`

### 5. Check preHideCSS Scope

The preHideCSS is injected via manifest CSS (before any JS) to prevent flash of plaintext. It must be:

- **Specific enough** — only hide elements that could contain keys. NEVER use `[data-state="open"] input[type="text"]` as it hides ALL text inputs including Name/label fields.
- **Platform-scoped** — each platform gets its own CSS file, no cross-platform collisions.
- **Key-display only** — target the key display container, not the entire dialog.

Common safe patterns:
- `[data-state="open"] code` — code blocks in dialogs (OpenAI)
- `.gl-alert-success .gl-alert-body input` — success alert with token (GitLab)
- `input#created-personal-access-token` — specific ID selectors (if stable)
- `.token-value, .api-key-value` — semantic class selectors

Dangerous patterns to avoid:
- `input[type="text"]` inside dialog — too broad, hides name/label inputs
- `mat-dialog-container input` — too broad for Google platforms
- `.modal input` — catches all modal inputs

### 6. Compare and Report

Compare the analysis results against the current `capture-patterns.ts` entry:

**Check these things:**
- Do the CSS selectors in `platformSelectors[].selectors` still match elements on the page?
- Has the element structure changed (different tag, different class names)?
- Are there new stable selectors that could be added?
- Has the key format (regex pattern) changed?
- Does the `preHideCSS` still target the right elements without being too broad?
- Is the key in `input.value` (SPA concern) or in a text node?
- Does the platform use native clipboard copy or `navigator.clipboard.writeText`?

**Format the report as:**

```
## Platform Analysis: [name]
Date: [ISO date]
URL: [actual URL visited]

### Current Selectors Status
- selector1: FOUND / MISSING / CHANGED
- selector2: FOUND / MISSING / CHANGED

### Key Format
- Current regex: [from capture-patterns.ts]
- Keys found on page: [count, prefix only]

### Framework & SPA Behavior
- Framework: [React/Vue/Angular/vanilla]
- Key in input.value: YES / NO (if YES, masker cannot replace — must keep hidden)
- Dialog type: [data-state="open"] / [role="dialog"] / .modal / .gl-alert / other
- Copy mechanism: [button click / clipboard-copy element / navigator.clipboard.writeText]

### preHideCSS Assessment
- Current CSS: [from capture-patterns.ts]
- Too broad: YES / NO (does it hide non-key elements like Name inputs?)
- Suggested CSS: [recommended CSS if changes needed]

### DOM Structure
- List page key element: [tag.class structure]
- Dialog key element: [tag.class structure]
- Stable selectors available: [list of reliable selectors]

### Recommendations
- [what to update in capture-patterns.ts]

### Browser Operations Log
- Navigated to: [URL]
- JavaScript executed: [description of what was run]
- Read-only: YES / NO
```

### 7. Save Report

Save the report to `scripts/platform-analysis/reports/[platform]-[YYYY-MM-DD].json`

## Safety Rules

These are non-negotiable:

1. **Never record actual API key values.** If keys appear in the analysis, truncate to the first 8 characters followed by `...`. The goal is to analyze DOM structure, not extract secrets.

2. **Never click "Create key" buttons** unless the user explicitly says something like "go ahead and create a test key". Creating keys has real consequences (billing, quota).

3. **Never modify any page content.** All operations are read-only DOM inspection.

4. **Report all browser operations.** At the end of every analysis, list every URL visited and every piece of JavaScript executed. The user needs to know exactly what happened in their authenticated browser session.

## Adding a New Platform

If the user asks to add support for a new platform (one not in the table above):

1. Navigate to the URL they provide
2. Run the full analysis
3. Based on results, draft a new `CapturePattern` entry for `capture-patterns.ts` including:
   - `id`, `serviceName`, `prefix`
   - `regex` based on key format found
   - `confidence` and `minLength`
   - `preHideCSS` targeting key display elements only (not form inputs)
   - `platformSelectors` with hostname, selectors, and strategy
   - Note if the platform uses SPA framework (affects masking strategy)
4. Also draft the `manifest.json` URL match entry
5. Draft the per-platform pre-hide CSS entry in manifest.json
6. Present both changes to the user for review before making any edits

## Known Platform Quirks

These were discovered through real-world testing (2026-03):

| Platform | Framework | Key Location | Quirk |
|----------|-----------|-------------|-------|
| OpenAI | React (Radix UI) | `input[type="text"]` in `[data-state="open"]` dialog | React overwrites `input.value`; must keep input hidden via CSS, not replace value |
| GitLab | Vue.js | `input.input-copy-show-disc` in `.gl-alert-success` | Redesigned from `#created-personal-access-token` / `.flash-notice` (2026) |
| AI Studio | Angular Material | `input` in `mat-dialog-container` | Uses `navigator.clipboard.writeText` (not `execCommand`); needs MAIN world clipboard patch |
| GitHub | Vanilla + Turbo | `clipboard-copy[value]` | Key in `value` attribute, not text node |
| HuggingFace | Custom | `input[readonly]` in modal | Input may lack `type` attribute; use `input[readonly]`, `input:not([type])` |
| AWS | React | Region subdomains (`us-east-1.console.aws.amazon.com`) | Need `*.console.aws.amazon.com` in manifest + subdomain matching in code |
