# Contributing to Demo-safe API Key Manager

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build all packages: `npm run build:all`
4. For Swift Core: `cd packages/swift-core && swift build`

## Making Changes

1. Create a feature branch from `main`: `git checkout -b feature/my-feature`
2. Make your changes
3. Ensure linting passes: `npm run lint`
4. Ensure builds succeed: `npm run build:all`
5. Commit with a descriptive message (see Commit Convention below)
6. Push and open a Pull Request

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `refactor:` — Code refactoring (no feature change)
- `test:` — Adding or updating tests
- `chore:` — Build, CI, or tooling changes

Examples:
```
feat: add floating toolbox HUD with hold-to-search
fix: resolve content script pattern matching for Anthropic keys
docs: update IPC protocol spec with new event types
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Link related issues if applicable
- Ensure CI passes before requesting review

## Project Structure

| Directory | Language | Description |
|-----------|----------|-------------|
| `packages/swift-core/` | Swift | macOS Menu Bar App |
| `packages/vscode-extension/` | TypeScript | VS Code Extension |
| `packages/chrome-extension/` | TypeScript | Chrome Extension (Manifest V3) |
| `shared/ipc-protocol/` | TypeScript | Shared IPC type definitions |
| `docs/` | Markdown | Architecture and spec documentation |

## Security

- **Never commit real API keys** — use test/fake keys for testing
- **Plaintext keys must never travel over IPC** — this is a hard security rule
- Review [docs/03-security/security-rules.md](docs/03-security/security-rules.md) before working on key-handling code

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include reproduction steps for bugs
- Include your macOS version, VS Code version, and Chrome version

## Code of Conduct

Please be respectful and constructive in all interactions. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
