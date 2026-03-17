# Supported Platforms

DemoSafe currently supports active key capture and masking for the following platforms:

| Platform | Key Prefix | Capture Method | Status |
|----------|-----------|----------------|--------|
| GitHub | `ghp_`, `github_pat_`, `gho_` | DOM scan + mask | ✅ Tested |
| HuggingFace | `hf_` | Input hidden + capture | ✅ Tested |
| GitLab | `glpat-` | Input polling + capture | ✅ Tested |
| OpenAI | `sk-proj-`, `sk-or-v1-` | Input hidden (React SPA) | ✅ Tested |
| Anthropic | `sk-ant-` | Text hidden + mask | ✅ Tested |
| Google AI Studio | `AIzaSy` | Clipboard interception | ✅ Tested |
| Google Cloud | `AIzaSy` | Dialog input capture | ✅ Tested |
| AWS | `AKIA` + Secret Key | DOM mask + clipboard interception | ✅ Tested |
| Stripe | `sk_live_`, `pk_live_`, `rk_live_` | Pattern defined | ⏳ Untested |
| Slack | `xoxb-`, `xoxp-`, `xapp-` | Pattern defined | ⏳ Untested |
| SendGrid | `SG.` | Pattern defined | ⏳ Untested |

## Adding New Platforms

The API key landscape is incredibly diverse — there are hundreds of platforms, each with unique key formats, UI structures, and frontend frameworks. It is not feasible for us to support every platform out of the box.

Our architecture is designed as a **Single Source of Truth**: adding support for a new platform requires only **one entry** in `capture-patterns.ts` and a URL match in `manifest.json`. No other code changes are needed.

### How to Contribute

If you use a platform that is not yet supported, we welcome your contribution! Here's how you can help:

1. **Open an Issue** — Describe the platform, key format (prefix, length), and the URL where keys are displayed. Screenshots of the key creation flow are very helpful.

2. **Submit a PR** — Add a new entry to [`capture-patterns.ts`](../../packages/chrome-extension/src/content-scripts/capture-patterns.ts) with:
   - `id`, `serviceName`, `prefix`
   - `regex` pattern for the key format
   - `preHideCSS` to prevent flash of plaintext
   - `platformSelectors` with hostname, CSS selectors, and capture strategy
   - URL match in `manifest.json`

3. **Use the Analysis Skill** — If you have Claude Code, run `/analyze-platform <url>` to automatically analyze a platform's DOM structure and generate the pattern entry.

### Platform Quirks to Be Aware Of

Different platforms use different frontend frameworks and key display methods. Common challenges include:

- **React / Vue SPA** — `input.value` gets overwritten by the framework; keys must stay hidden via CSS rather than replaced
- **Clipboard API** — Some platforms use `navigator.clipboard.writeText` instead of DOM text; requires MAIN world script injection
- **Dynamic class names** — Obfuscated CSS classes change on every build; selectors must use stable attributes (`role`, `data-*`, `aria-label`)
- **Subdomain variations** — Platforms like AWS use region subdomains (e.g., `us-east-1.console.aws.amazon.com`)

We appreciate any feedback, bug reports, or contributions to expand platform coverage!
