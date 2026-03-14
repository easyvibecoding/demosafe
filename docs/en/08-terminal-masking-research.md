# Terminal Masking Technical Research

> Status: Future Goal
> Last updated: 2026-03-14

---

## Background

Currently the VS Code Extension only provides Editor Decoration masking. API Keys in terminal output (e.g., Claude Code terminal, `curl` responses, `env` prints) are still displayed in plaintext. Terminal Masking is a critical gap in complete masking protection.

---

## Approach Comparison

### Approach A: node-pty Proxy Terminal (Primary Approach)

**Principle**: Use `node-pty` to spawn a real shell, intercept all output, replace sensitive text, then send to VS Code Terminal.

```
VS Code Terminal (what the user sees, filtered)
    ^ writeEmitter.fire(filtered)
Proxy Layer (maskSecrets regex filtering)
    ^ ptyProcess.onData(raw)
node-pty (real shell process)
```

**Implementation Details**:
- Implement the `vscode.Pseudoterminal` interface
- `ptyProcess.onData()` -> `maskSecrets(data)` -> `writeEmitter.fire(filtered)`
- Input passthrough: `handleInput(data)` -> `ptyProcess.write(data)`
- node-pty loading with three-tier fallback:
  1. `require('node-pty')`
  2. VS Code built-in `vscode.env.appRoot/node_modules.asar.unpacked/node-pty`
  3. `vscode.env.appRoot/node_modules/node-pty`

**Advantages**:
- Text is replaced before reaching the terminal, **strongest security guarantee**
- Copy-paste also returns the masked version
- Safe for screenshots and OBS recordings
- Tab completion, colors, and other PTY features fully preserved

**Disadvantages**:
- node-pty is a native module requiring a build environment
- Chunk boundary issue: PTY output arrives in arbitrary chunks, potentially splitting a secret mid-stream; requires a ring buffer / lookback window
- Regex matching on every chunk may cause latency during high output volume

**Reference Implementation**: `files_demo/` directory (Secret Shield v2)

---

### Approach B: ANSI Escape Code fg=bg Same-Color Hiding (Fallback Approach)

**Principle**: Use ANSI escape codes to set the foreground color of sensitive text to match the background color, making it visually invisible.

```
Original output: sk-proj-abc123xyz
After processing: \033[30;40m sk-proj-abc123xyz \033[0m
                  ^^^^^^^^^ black text on black background, visually invisible
```

**Inspiration Source**: Terminal rendering tech stack used by the ast-grep project:
- `ansi_term` -- ANSI escape code coloring
- `crossterm` -- terminal control (alternate screen, cursor positioning)
- `terminal-light` -- detect terminal background color (light/dark)

ast-grep itself does not use fg=bg hiding, but its toolchain fully supports this direction. `terminal-light`'s background color detection is particularly important for this approach.

**Implementation Details**:
- Intercept terminal output (same Pseudoterminal or output interceptor as Approach A)
- Detect terminal background color (light/dark theme)
- Wrap matched secret text in fg=bg ANSI escape codes
- Optional: replace with masked text instead of same-color hiding

**Advantages**:
- Does not require the node-pty native module
- Lower implementation complexity
- No chunk boundary issues (can operate on complete lines)

**Disadvantages**:
- **Weaker security**:
  - Selecting text reveals the original key through highlighting
  - Theme switching (light <-> dark) may cause momentary color mismatch
  - Some terminal emulators may not respect background color settings
  - Screen recording software may parse ANSI codes and recover the text
- Depends on correct background color detection
- Inconsistent behavior across different terminal emulators

---

### Approach C: Hybrid Approach (Recommended)

Combines the advantages of Approaches A and B:

1. **Primary path**: node-pty proxy replaces sensitive text (security guarantee)
2. **Fallback**: When node-pty cannot be loaded, use `FallbackShieldedTerminal` (`child_process.spawn` + line mode)
3. **Additional layer**: In fallback mode, use ANSI fg=bg as an extra visual hiding layer

**Loading Priority**:
```
Attempt node-pty (proxy terminal, full PTY features)
    | failure
Attempt child_process.spawn (line mode, sacrificing tab completion)
    | combined with
ANSI fg=bg same-color (additional visual hiding)
```

---

## Approach Comparison Matrix

| Dimension | A: node-pty proxy | B: ANSI fg=bg | C: Hybrid |
|-----------|-------------------|---------------|-----------|
| Security Level | Highest (text replaced) | Medium (text still exists) | Highest |
| Native Module Dependency | Requires node-pty | Not required | Optional |
| PTY Feature Completeness | Full | Full | Full (primary) / Partial (fallback) |
| Copy Safety | Safe | **Unsafe** | Safe (primary) / Unsafe (fallback) |
| Screenshot Safety | Safe | Depends on terminal | Safe |
| Implementation Complexity | High | Low | High |
| Chunk Boundary | Needs handling | None (line mode) | Needs handling (primary) / None (fallback) |

---

## Known Challenges

### Chunk Boundary Issue
PTY output arrives at arbitrary byte boundaries. An API key `sk-proj-abc123` may be split into `sk-proj-` and `abc123` across two chunks.

**Solution**: Ring buffer / lookback window
- Maintain a buffer of the most recent N bytes
- When a new chunk arrives, merge it with the buffer tail and scan
- Only output confirmed safe portions, potentially delaying bytes up to the longest pattern length

### node-pty Build Environment
| Platform | Requirements |
|----------|-------------|
| macOS | `xcode-select --install` |
| Windows | `windows-build-tools` |
| Linux | `build-essential` |

### Performance Considerations
- Regex matching required for every chunk
- High output scenarios (e.g., `cat` on large files) may cause noticeable latency
- **Mitigation**: Only enable masking when Demo Mode is on; passthrough when off

---

## Technical References

| Resource | Description |
|----------|-------------|
| `files_demo/shielded-terminal.ts` | Complete node-pty proxy terminal implementation |
| `files_demo/extension.ts` | Complete extension integration (7 commands, status bar, toggle) |
| `files_demo/patterns.ts` | Built-in regex patterns (Anthropic, OpenAI, AWS, GitHub, etc.) |
| [ast-grep](https://github.com/ast-grep/ast-grep) | Terminal rendering tech stack reference (ansi_term, crossterm, terminal-light) |
| [node-pty](https://github.com/microsoft/node-pty) | PTY native module |
| [crossterm](https://docs.rs/crossterm/) | Rust cross-platform terminal control |
| [terminal-light](https://crates.io/crates/terminal-light) | Detect terminal background color (light/dark) |
