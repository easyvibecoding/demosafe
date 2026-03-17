# Demo-safe API Key Manager -- Documentation Index

This directory splits the original `.docx` specification documents into searchable, version-controllable Markdown files for quick reference during development.

## Directory Structure

| Directory | Contents |
|-----------|----------|
| `01-product-spec/` | Product overview, target users, use cases, MVP scope and roadmap, **implementation status tracking** |
| `02-technical-architecture/` | System architecture, data models, Swift Core six modules, **VS Code Extension architecture**, **Chrome Extension architecture**, module dependencies |
| `03-security/` | Security red lines, storage strategy, clipboard security, IPC security rules |
| `04-ui-ux/` | State machine, Menu Bar App, floating toolbox, keyboard shortcuts, settings page, **context modes**, **smart Key capture** |
| `05-ipc-protocol/` | Connection mechanism, message format, Request/Event Actions, Pattern Cache sync |
| `06-pattern-reference/` | Built-in regex pattern library, masking format rules, custom pattern guidelines |
| `07-known-issues-and-improvements.md` | Known issues and pending improvements |
| `08-terminal-masking-research.md` | Terminal Masking technical research (node-pty vs ANSI fg=bg vs hybrid approach) |
| `09-api-key-rotation-best-practices.md` | API Key deployment and rotation best practices by platform, zero-downtime rotation patterns |
| `10-active-key-capture.md` | Active API Key web capture (Chrome Extension auto-detection and capture) |
| `13-supported-platforms.md` | Supported platforms table, contribution guide, and platform quirks |

## Source Document Mapping

| Original Document | Corresponding Sections |
|-------------------|----------------------|
| `Demo-safe_API_Key_Manager_Spec.docx` | 01, 04, 06 |
| `Demo-safe_API_Key_Manager_Technical_Architecture.docx` | 02, 03, 05 |

## Quick Reference

| I want to... | Read this document |
|--------------|-------------------|
| Understand what has been completed | [implementation-status.md](01-product-spec/implementation-status.md) |
| Understand what to do next | [roadmap.md](01-product-spec/roadmap.md) + [implementation-status.md](01-product-spec/implementation-status.md) |
| Understand security red lines | [security-rules.md](03-security/security-rules.md) |
| Understand IPC message format | [protocol-spec.md](05-ipc-protocol/protocol-spec.md) |
| Understand Pattern regex | [masking-format.md](06-pattern-reference/masking-format.md) |
| Understand known bugs | [07-known-issues-and-improvements.md](07-known-issues-and-improvements.md) |
| Understand Chrome Extension architecture | [chrome-extension-architecture.md](02-technical-architecture/chrome-extension-architecture.md) |
| Understand VS Code Extension architecture | [vscode-extension-architecture.md](02-technical-architecture/vscode-extension-architecture.md) |
| Understand Terminal Masking approaches | [08-terminal-masking-research.md](08-terminal-masking-research.md) |
| Understand Active Key Capture | [10-active-key-capture.md](10-active-key-capture.md) |
| See supported platforms + add new ones | [13-supported-platforms.md](13-supported-platforms.md) |

> All documents are written in English. Traditional Chinese versions are available in the parent docs/ directory.
