---
name: test-capture-flow
description: "End-to-end test of the Active Key Capture pipeline on real platforms. Creates a test API key, measures capture timing, verifies masking and vault storage, then cleans up. Use when testing capture on a platform, debugging flash issues, measuring pre-hide timing, or verifying the full capture-to-mask pipeline. Invoke with '/test-capture-flow huggingface' or '/test-capture-flow anthropic'."
user-invocable: true
---

# Capture Flow End-to-End Tester

Automated testing of the full Active Key Capture pipeline: key creation → pre-hide → capture → mask → toast → vault storage → cleanup.

This skill creates real API keys on platforms, so it has real consequences (quota, billing). Always confirm with the user before proceeding.

## Arguments

`$ARGUMENTS` should be a platform name. Supported platforms for automated testing:

| Name | URL | Can auto-create |
|------|-----|-----------------|
| huggingface | https://huggingface.co/settings/tokens/new | Yes (empty permissions) |
| anthropic | https://platform.claude.com/settings/keys | Yes (if billing active) |
| github | https://github.com/settings/tokens | Yes (classic PAT, no scopes) |

Other platforms may require manual key creation — the skill will guide the user through the process and still measure the capture flow.

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
- Navigate to the platform's key creation page
- Take a screenshot (baseline, before key creation)
- Verify content script is loaded (check for demosafe-mask style element)
- Verify pre-hide CSS is injected (check for #demosafe-pre-hide element)
- Record timestamp T0
```

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
// Check these states in order:
({
  preHideActive: !!document.getElementById('demosafe-pre-hide'),
  prehiddenElements: document.querySelectorAll('[data-demosafe-prehidden]').length,
  captured: !!document.querySelector('[data-demosafe-original]'),
  maskedCount: document.querySelectorAll('.demosafe-mask').length,
  toastVisible: !!document.querySelector('.demosafe-toast'),
})
```

Record timestamps for each state transition:
- T2: pre-hide active (key area hidden)
- T3: key captured (data-demosafe-original set)
- T4: key masked (demosafe-mask span visible)
- T5: toast appeared

### Step 5: Take Post-Capture Screenshot

```
- Take screenshot showing the masked key in the dialog/page
- Compare visually: is the key fully masked? Any partial exposure?
```

### Step 6: Verify Vault Storage

```bash
# Check vault.json for the newly captured key
python3 -c "
import json
vault = json.load(open('$HOME/Library/Application Support/DemoSafe/vault.json'))
latest = vault['keys'][-1]
print(f'Latest key: {latest[\"label\"]} service={latest.get(\"serviceId\",\"?\")[:8]}')
"
```

### Step 7: Cleanup

```
- Delete the test key from the platform (find and click delete/revoke)
- Verify it's removed from the list
- Note: DO NOT delete from DemoSafe vault (keep for pattern testing)
```

### Step 8: Generate Report

```
## E2E Test Report: [platform]
Date: [ISO date]

### Timing
| Event | Timestamp | Delta from T1 |
|-------|-----------|---------------|
| Create clicked (T1) | ... | 0ms |
| Pre-hide active (T2) | ... | +Xms |
| Key captured (T3) | ... | +Xms |
| Masked in DOM (T4) | ... | +Xms |
| Toast appeared (T5) | ... | +Xms |

### Flash Duration
Time from key visible to masked: T4 - T1 = Xms
Pre-hide effectiveness: T2 < T1? (CSS was already injected)

### Results
- Pre-hide: PASS/FAIL (key area hidden before creation)
- Capture: PASS/FAIL (key value extracted)
- Masking: PASS/FAIL (DOM text replaced)
- Toast: PASS/FAIL (notification shown)
- Vault storage: PASS/FAIL (key in vault.json)
- Cleanup: PASS/FAIL (test key deleted from platform)

### Screenshots
- Baseline: [before creation]
- Masked: [after capture]

### Recommendations
- [any timing issues or improvements needed]
```

## Safety Rules

1. **Always ask before creating a key.** Say: "I'm about to create a test API key on [platform] with no permissions. This will use your account. Proceed?"
2. **Use minimal permissions.** Never check any permission scopes on test keys.
3. **Clean up after testing.** Always delete the test key from the platform.
4. **Name test keys clearly.** Use `demosafe-e2e-test-[timestamp]` so they're easy to identify.
5. **Report all browser operations.** List every URL visited, button clicked, and form filled.

## Platform-Specific Notes

### HuggingFace
- Create at `/settings/tokens/new?tokenType=fineGrained`
- Fill `Token name` input, uncheck all checkboxes, click "Create token"
- Key appears in `<input readonly>` in a modal
- Delete via three-dot menu on tokens list page

### Anthropic/Claude
- Create at `platform.claude.com/settings/keys`
- Click "Create Key" → fill name → select workspace "Default" → click "Add"
- Key appears in `<p class="font-mono">` inside dialog
- Delete via "More actions" menu on list page

### GitHub
- Create at `github.com/settings/tokens` → "Generate new token" → Classic
- Fill note, don't check any scopes, click "Generate token"
- Key appears in `<code id="new-oauth-token">`
- Delete via "Delete" button on token page
