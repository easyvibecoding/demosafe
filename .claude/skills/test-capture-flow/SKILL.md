---
name: test-capture-flow
description: "End-to-end test of the Active Key Capture pipeline on real platforms. Creates a test API key, measures capture timing, verifies masking and vault storage, then cleans up. Use when testing capture on a platform, debugging flash issues, measuring pre-hide timing, or verifying the full capture-to-mask pipeline. Invoke with '/test-capture-flow huggingface' or '/test-capture-flow openai'."
user-invocable: true
---

# Capture Flow End-to-End Tester

Automated testing of the full Active Key Capture pipeline: key creation → pre-hide → capture → toast → vault storage → cleanup.

This skill creates real API keys on platforms, so it has real consequences (quota, billing). Always confirm with the user before proceeding.

## Arguments

`$ARGUMENTS` should be a platform name. Supported platforms for automated testing:

| Name | URL | Can auto-create | Key location |
|------|-----|-----------------|-------------|
| huggingface | https://huggingface.co/settings/tokens/new | Yes (empty permissions) | `input[readonly]` in modal |
| anthropic | https://platform.claude.com/settings/keys | Yes (if billing active) | `<p class="font-mono">` in dialog |
| github | https://github.com/settings/tokens | Yes (classic PAT, no scopes) | `clipboard-copy[value]` |
| gitlab | https://gitlab.com/-/user_settings/personal_access_tokens | Yes (read_user scope) | `input.input-copy-show-disc` in `.gl-alert-success` |
| openai | https://platform.openai.com/api-keys | Yes | `input[type="text"]` in `[data-state="open"]` dialog (React) |
| ai-studio | https://aistudio.google.com/apikey | Yes (if billing) | `input` in `mat-dialog-container` + clipboard writeText |
| google-cloud | https://console.cloud.google.com/apis/credentials | Needs project | `input` in `mat-dialog-container` |
| aws | https://console.aws.amazon.com/iam/home#/security_credentials | Yes | table cell after creation |

Other platforms (Stripe, Slack, SendGrid) may require manual key creation — the skill will guide the user through the process and still measure the capture flow.

## Prerequisites

Before running, verify:
1. **DemoSafe Core is running** — check `ps aux | grep DemoSafe`
2. **Chrome Extension is loaded** — user should confirm popup shows "Connected"
3. **Demo Mode is ON** — auto-capture only works in Demo Mode on supported platforms
4. **User is logged into the target platform** in Chrome

## Workflow

### Step 1: Pre-flight Checks

```
- Verify DemoSafe Core process is running
- Check ~/.demosafe/ipc.json exists and has recent port/token
- Ask user to confirm: "Demo Mode ON? Extension Connected? Logged into [platform]?"
```

### Step 2: Navigate and Baseline

```
- Navigate to the platform's key page
- Take a screenshot (baseline, before key creation)
- Verify content script is loaded:
```

```javascript
// Check masker.ts is loaded (it injects this style)
const maskerLoaded = !!Array.from(document.querySelectorAll('style'))
  .find(s => s.textContent?.includes('demosafe-mask'));
// Check manifest CSS is active (try matching a preHideCSS selector)
const manifestCSS = 'active'; // manifest CSS is invisible to JS, verify via computed styles
```

Record timestamp T0.

### Step 3: Create Test Key

```
- Fill in key name: "demosafe-e2e-test-[timestamp]"
- Uncheck all permissions/scopes (minimal access)
- Click Create/Add button
- Record timestamp T1 (key creation clicked)
```

### Step 4: Measure Capture Timing

Immediately after clicking Create, poll every 100ms for up to 10 seconds:

```javascript
// Check capture states:
({
  // Pre-hide: manifest CSS keeps key hidden (can't detect directly,
  // check computed visibility on key container)
  keyInputHidden: (() => {
    const el = document.querySelector('[data-state="open"] input[type="text"], .gl-alert-success input, mat-dialog-container input');
    return el ? getComputedStyle(el).visibility === 'hidden' : false;
  })(),
  // Capture: data-demosafe-original attribute set on input
  captured: !!document.querySelector('[data-demosafe-original]'),
  // For non-SPA platforms: text node replaced with masked span
  maskedCount: document.querySelectorAll('.demosafe-mask').length,
  // Toast notification appeared
  toastVisible: !!document.querySelector('.demosafe-toast'),
})
```

Record timestamps for each state transition:
- T2: key area hidden (manifest CSS or instant observer)
- T3: key captured (`data-demosafe-original` set OR toast appeared)
- T4: key masked (`.demosafe-mask` span visible) — NOTE: for SPA platforms (OpenAI, GitLab), dialog inputs stay HIDDEN instead of showing masked text
- T5: toast appeared

### Step 5: Take Post-Capture Screenshot

```
- Take screenshot showing the result
- For SPA platforms: key input should be HIDDEN (blank area with Copy button)
- For non-SPA platforms: key text should be replaced with masked span
- Check for any partial plaintext exposure
```

### Step 6: Verify Vault Storage

Keys are stored in macOS Keychain, not a JSON file. Verify via the background service worker or DemoSafe Core logs:

```javascript
// Check via page — look for toast content which confirms capture
const toast = document.querySelector('.demosafe-toast');
const captured = toast?.textContent?.includes('captured');
```

Alternatively, check the DemoSafe Core logs:
```bash
log show --predicate 'subsystem == "com.demosafe.core"' --last 1m --style compact | grep -i "captured\|submit\|vault"
```

### Step 7: Cleanup

```
- Delete/revoke the test key from the platform
- Verify it's removed from the list
- Note: DO NOT delete from DemoSafe vault (keep for pattern testing)
```

### Step 8: Generate Report

```
## E2E Test Report: [platform]
Date: [ISO date]

### Platform Info
- Framework: [React/Vue/Angular/vanilla]
- Key display: [input.value / text node / attribute]
- Masking strategy: [hidden (SPA) / replaced (non-SPA)]

### Timing
| Event | Timestamp | Delta from T1 |
|-------|-----------|---------------|
| Create clicked (T1) | ... | 0ms |
| Key area hidden (T2) | ... | +Xms |
| Key captured (T3) | ... | +Xms |
| Toast appeared (T5) | ... | +Xms |

### Flash Assessment
- Flash of plaintext: NONE / BRIEF (<100ms) / VISIBLE (>100ms)
- Pre-hide method: manifest CSS / instant observer / both
- SPA input handling: hidden / replaced / N/A

### Results
- Pre-hide: PASS/FAIL (key area hidden before/when key appears)
- Capture: PASS/FAIL (key value extracted and submitted)
- Visual safety: PASS/FAIL (no plaintext visible after capture)
- Toast: PASS/FAIL (notification shown)
- Vault storage: PASS/FAIL (captured key stored)
- Name input: PASS/FAIL/N/A (Name field still editable — not hidden by preHideCSS)
- Cleanup: PASS/FAIL (test key deleted from platform)

### Screenshots
- Baseline: [before creation]
- Post-capture: [after capture, showing hidden/masked key]

### Recommendations
- [any timing issues, selector changes, or improvements needed]
```

## Safety Rules

1. **Always ask before creating a key.** Say: "I'm about to create a test API key on [platform] with no permissions. This will use your account. Proceed?"
2. **Use minimal permissions.** Never check any permission scopes on test keys.
3. **Clean up after testing.** Always delete the test key from the platform.
4. **Name test keys clearly.** Use `demosafe-e2e-test-[timestamp]` so they're easy to identify.
5. **Report all browser operations.** List every URL visited, button clicked, and form filled.

## Platform-Specific Notes

### OpenAI (React / Radix UI)
- Create at `platform.openai.com/api-keys` → "+ Create new secret key"
- Fill Name (optional), select Project, click "Create secret key"
- Key appears in `input[type="text"]` inside `[data-state="open"]` dialog
- **SPA quirk**: React controls `input.value` — masker keeps input HIDDEN via manifest CSS instead of replacing value. This is correct behavior.
- preHideCSS must NOT include `input[type="text"]` (too broad, hides Name input in create dialog)
- Copy button uses standard click handler
- Delete via trash icon on list page

### GitLab (Vue.js)
- Create at `gitlab.com/-/user_settings/personal_access_tokens` → "Add new token"
- Fill Token name, select scope (e.g., `read_user`), click "Generate token"
- Key appears in `input.input-copy-show-disc` inside `.gl-alert-success .gl-alert-body`
- GitLab's own CSS shows dots via `webkitTextSecurity: disc`, but actual value is in `input.value`
- Capture works via input polling (500ms interval)
- Revoke via three-dot menu on token row

### AI Studio / Gemini (Angular Material)
- Create at `aistudio.google.com/apikey` → "Create API key"
- Key appears in `input` inside `mat-dialog-container`
- Has Copy icon button that uses `navigator.clipboard.writeText` (NOT `execCommand`)
- Requires `clipboard-patch.ts` in MAIN world to intercept clipboard writes
- preHideCSS targets `mat-dialog-container .api-key` (NOT `mat-dialog-container input` — too broad)

### HuggingFace
- Create at `/settings/tokens/new?tokenType=fineGrained`
- Fill `Token name` input, uncheck all checkboxes, click "Create token"
- Key appears in `<input readonly>` in a modal — may lack `type` attribute
- Selectors should include `input[readonly]`, `input:not([type])` to catch both cases
- Delete via three-dot menu on tokens list page

### Anthropic/Claude
- Create at `platform.claude.com/settings/keys`
- Click "Create Key" → fill name → select workspace "Default" → click "Add"
- Key appears in `<p class="font-mono">` inside dialog
- Delete via "More actions" menu on list page

### GitHub (Vanilla + Turbo)
- Create at `github.com/settings/tokens` → "Generate new token" → Classic
- Fill note, don't check any scopes, click "Generate token"
- Key appears in `clipboard-copy[value]` attribute — use `getAttribute('value')` to read
- Page uses Turbo for navigation (partial reloads)
- Delete via "Delete" button on token page

### AWS
- Navigate to IAM Security Credentials
- Uses React, region subdomains (`us-east-1.console.aws.amazon.com`)
- Need `*.console.aws.amazon.com` in manifest for subdomain matching
- Access keys shown in table after creation
