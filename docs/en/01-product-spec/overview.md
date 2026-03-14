# Product Overview

## Problem Statement

Developers and product teams frequently face a critical challenge during live demos, livestreams, and tutorial content creation: they need to demonstrate real API Key workflows (generating keys, pasting into config files, deploying services) while ensuring sensitive credentials never appear on screen.

Existing alternatives (manually blurring videos, using environment variables, hoping the audience doesn't notice) are fragile and error-prone.

## Solution

**Demo-safe API Key Manager** is a macOS system-level tool that hides plaintext from the moment an API Key enters your workflow until deployment is complete. Like the macOS Keychain, keys are never displayed in plaintext — but remain fully usable through copy and paste.

## Core Design Principle

**Hidden but Usable** — The screen shows `sk-proj-****...****` but the clipboard contains the full key.

## Target Users

| User Type | Description |
|-----------|-------------|
| **Product team live demos** | Major product launches and demos where thousands of viewers watch API Key workflows simultaneously |
| **Developer community educators** | Tutorial content creators demonstrating the full flow of generating keys, configuring services, and deploying applications from start to finish |
| **DevRel and conference speakers** | Live coding demos at conferences where any screen capture could expose credentials |

## Key Use Cases

| Scenario | Current Pain Point | Demo-safe Solution |
|----------|-------------------|-------------------|
| Generating API Key on OpenAI | Key is briefly visible; must blur in post-production or risk exposure | Chrome Extension auto-captures key; plaintext never displayed |
| Pasting Key into .env file in VS Code | Full key is completely visible when typing in editor | VS Code Extension renders masked version; clipboard retains real key |
| Deploying with Key in terminal | Terminal displays key in command output | System-level masking covers terminal and all displays |
| Multi-service setup (AWS + Stripe + OpenAI) | Managing multiple keys during demos is chaotic | Linked key groups; one hotkey pastes the correct key |

## Three-Layer System Architecture

| Layer | Technology | Coverage | Phase |
|-------|-----------|----------|-------|
| Core Engine | Swift (macOS Menu Bar App) | Key storage, clipboard, hotkeys, system tray | **MVP** |
| IDE Layer | VS Code Extension | Editor file detection and inline masking | **MVP** |
| Browser Layer | Chrome Extension | Web console auto-capture and page masking | Phase 2 |
| System Layer | macOS Accessibility API | Full-screen, all apps, all displays masking | Phase 3 |

## Communication Flow

```
[VS Code Ext] ↔ [Core Engine (Swift)] ↔ [Chrome Ext]
                       ↕
              [Accessibility API]
```

Key storage is local only (Keychain-based), encrypted at rest. v1 does not support cloud sync.
