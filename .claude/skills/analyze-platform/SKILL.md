---
name: analyze-platform
description: Analyze API key page DOM structure for capture-patterns.ts maintenance. Use when a platform UI changes or when adding a new platform to DemoSafe.
context: fork
agent: Explore
---

# Platform DOM Analysis

Analyze the target API key management page to maintain capture-patterns.ts selectors.

**Arguments**: $ARGUMENTS (platform name or URL)

Platform name shortcuts: openai, anthropic, github, google-cloud, stripe, aws, huggingface, slack, sendgrid, gitlab

## Steps

1. **Load the analysis script**: Read `scripts/platform-analysis/analyze-dom.js` from this project

2. **Navigate** to the target platform's API key page using Chrome MCP tools:
   - openai → `https://platform.openai.com/api-keys`
   - anthropic → `https://console.anthropic.com/settings/keys`
   - github → `https://github.com/settings/tokens`
   - google-cloud → `https://console.cloud.google.com/apis/credentials`
   - stripe → `https://dashboard.stripe.com/apikeys`
   - aws → `https://console.aws.amazon.com/iam/home#/security_credentials`
   - huggingface → `https://huggingface.co/settings/tokens`
   - slack → `https://api.slack.com/apps`
   - sendgrid → `https://app.sendgrid.com/settings/api_keys`
   - gitlab → `https://gitlab.com/-/user_settings/personal_access_tokens`

3. **Execute** the analyze-dom.js script on the page via `mcp__claude-in-chrome__javascript_tool`

4. **Read** current selectors from `packages/chrome-extension/src/content-scripts/capture-patterns.ts`

5. **Compare** and report:
   - Which existing selectors still work on the page
   - Which selectors have changed or broken
   - New stable selectors discovered
   - Key format (regex) changes needed
   - Framework or CSS strategy changes

6. **Save** the analysis report to `scripts/platform-analysis/reports/{platform}-{date}.json`

## Rules

- Do NOT record actual API key values (truncate to first 20 chars + `...`)
- After completion, list ALL browser URLs visited and JavaScript executed
- Do NOT click "Create key" buttons unless explicitly instructed by the user
- Only visit the specific platform requested, do not browse other pages
