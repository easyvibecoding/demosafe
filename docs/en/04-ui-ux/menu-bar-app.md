# Menu Bar App

The Menu Bar App is the command center. Clicking the icon expands a dropdown panel divided into three sections.

---

## Section 1: Status Bar

Displays the current mode status, for example:

```
🔴 Demo Mode • Recording Safe
```

Accompanied by a prominent toggle button.

---

## Section 2: Key Library (Two-Level Hierarchy)

Keys are organized in a collapsible tree structure:

### Level 1 — Service/Company
OpenAI, AWS, Stripe, Anthropic, etc.

### Level 2 — Specific Keys
API Key, Secret Key, Org ID, Access Token, etc.

### Each Key Row Displays

| Element | Description |
|---------|-------------|
| Masked preview | e.g., `sk-proj-****...8f3a` |
| Shortcut number | e.g., `⌥ 1` |
| Linked group indicator | For associated Keys |

---

## Section 3: Quick Actions

| Action | Description |
|--------|-------------|
| **Smart Extract Current Page** | Triggers Chrome Extension to scan and import Keys from the current browser tab |
| **Context Mode Switcher** | Dropdown to select current context preset (Livestream, Tutorial Recording, Internal Demo, Development) |
| **Open Settings** | Opens the full settings window |
