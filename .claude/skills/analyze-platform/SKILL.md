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

### 3. Compare and Report

Compare the analysis results against the current `capture-patterns.ts` entry:

**Check these things:**
- Do the CSS selectors in `platformSelectors[].selectors` still match elements on the page?
- Has the element structure changed (different tag, different class names)?
- Are there new stable selectors that could be added?
- Has the key format (regex pattern) changed?
- Does the `preHideCSS` still target the right elements?
- What framework does the page use? Has it changed?
- Are there any new custom elements or Web Components?

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

### DOM Structure
- Framework: [detected]
- Key element: [tag.class structure]
- Dialog/Modal: [structure if found]
- Copy mechanism: [how copy works]

### Recommendations
- [what to update in capture-patterns.ts]

### Browser Operations Log
- Navigated to: [URL]
- JavaScript executed: [description of what was run]
- Read-only: YES / NO
```

### 4. Save Report

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
   - `preHideCSS` targeting the key display elements
   - `platformSelectors` with hostname, selectors, and strategy
4. Also draft the `manifest.json` URL match entry
5. Present both changes to the user for review before making any edits

## Example

When the user runs `/analyze-platform github`:

1. Read `analyze-dom.js` and the GitHub entries in `capture-patterns.ts`
2. Navigate to `https://github.com/settings/tokens`
3. Execute the analysis script
4. Check if `code#new-oauth-token`, `code.token`, `clipboard-copy[value]`, `.flash code` still exist on the page
5. Report findings and any selector changes needed
6. Save report to `scripts/platform-analysis/reports/github-2026-03-17.json`
7. List all browser operations performed
