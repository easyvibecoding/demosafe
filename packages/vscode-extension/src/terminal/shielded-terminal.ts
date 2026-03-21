/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { TerminalPattern, maskTerminalOutput } from './terminal-patterns';

// DEC private mode 2026 — Synchronized Output markers
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

/**
 * ShieldedTerminal — node-pty proxy terminal for API key masking.
 *
 * Architecture:
 *   [VS Code Terminal (Pseudoterminal)]
 *       ↕ handleInput() / onDidWrite
 *   [ShieldedTerminal]
 *       ↕ write() / onData()
 *   [node-pty (real shell process)]
 *
 * Sync block aware: Claude Code wraps each render in DEC 2026 sync blocks
 * (\x1b[?2026h ... \x1b[?2026l). We buffer the entire sync block before
 * masking, ensuring API keys split across PTY chunks are fully assembled.
 *
 * Non-sync data (regular shell output) is masked with a short timeout buffer.
 */
export class ShieldedTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<number | void>();
    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

    private nameEmitter = new vscode.EventEmitter<string>();
    onDidChangeName: vscode.Event<string> = this.nameEmitter.event;

    private ptyProcess: any = null;
    private _shieldEnabled: boolean;
    private patterns: TerminalPattern[];
    private maskedCount = 0;
    private outputChannel: vscode.OutputChannel;

    // Raw accumulation buffer — ALL data goes here first
    private rawBuffer = '';
    private inSyncBlock = false;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly FLUSH_DELAY_MS = 30;
    // Max length of sync markers (for partial marker detection)
    private static readonly MARKER_MAX_LEN = Math.max(SYNC_START.length, SYNC_END.length);

    constructor(
        private cwd: string,
        shieldEnabled: boolean,
        patterns: TerminalPattern[],
        outputChannel: vscode.OutputChannel,
        private shellPath?: string,
        private shellArgs?: string[],
    ) {
        this._shieldEnabled = shieldEnabled;
        this.patterns = patterns;
        this.outputChannel = outputChannel;
    }

    get shieldEnabled(): boolean {
        return this._shieldEnabled;
    }

    set shieldEnabled(value: boolean) {
        this._shieldEnabled = value;
        const msg = value
            ? '\r\n\x1b[42;30m Shield: ON \x1b[0m\r\n'
            : '\r\n\x1b[43;30m Shield: OFF \x1b[0m\r\n';
        this.writeEmitter.fire(msg);
    }

    updatePatterns(patterns: TerminalPattern[]) {
        this.patterns = patterns;
    }

    async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
        const cols = initialDimensions?.columns || 80;
        const rows = initialDimensions?.rows || 30;

        try {
            const pty = loadNodePty();

            const shell = this.shellPath || getDefaultShell();
            const args = this.shellArgs || [];

            this.outputChannel.appendLine(`[ShieldedTerminal] Shell: ${shell} ${args.join(' ')}`);
            this.outputChannel.appendLine(`[ShieldedTerminal] CWD: ${this.cwd}, ${cols}x${rows}`);

            this.ptyProcess = pty.spawn(shell, args, {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: this.cwd,
                env: { ...process.env } as { [key: string]: string },
            });

            this.ptyProcess.onData((data: string) => {
                if (this._shieldEnabled) {
                    this.processOutput(data);
                } else {
                    this.writeEmitter.fire(data);
                }
            });

            this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
                this.outputChannel.appendLine(`[ShieldedTerminal] Exit code ${exitCode}`);
                this.flushRemainingBuffer();
                this.closeEmitter.fire(exitCode);
            });

            const statusText = this._shieldEnabled ? 'ON' : 'OFF';
            this.writeEmitter.fire(
                `\x1b[90m[DemoSafe Shield: ${statusText}] Terminal ready.\x1b[0m\r\n`
            );
        } catch (err: any) {
            this.outputChannel.appendLine(`[ShieldedTerminal] ERROR: ${err.message}`);
            this.writeEmitter.fire(
                `\r\n\x1b[31m[DemoSafe] Failed to start shielded terminal: ${err.message}\x1b[0m\r\n` +
                `\x1b[33mFalling back to basic mode (no tab completion).\x1b[0m\r\n` +
                `\x1b[33mFor full PTY support, ensure node-pty is available.\x1b[0m\r\n`
            );
        }
    }

    handleInput(data: string): void {
        if (!this.ptyProcess) { return; }
        this.ptyProcess.write(data);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        if (this.ptyProcess) {
            this.ptyProcess.resize(dimensions.columns, dimensions.rows);
        }
    }

    close(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.ptyProcess) {
            this.ptyProcess.kill();
            this.ptyProcess = null;
        }
    }

    getMaskedCount(): number {
        return this.maskedCount;
    }

    /**
     * Process PTY output with sync block awareness.
     *
     * All data accumulates in rawBuffer first, then we scan for complete
     * sync blocks and plain segments. This handles the case where sync
     * markers (\x1b[?2026h / \x1b[?2026l) are split across PTY chunks.
     */
    private processOutput(data: string): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        this.rawBuffer += data;
        this.drainBuffer();
    }

    /**
     * Scan rawBuffer for complete sync blocks and plain segments.
     * Output everything that's complete; keep partial data in buffer.
     */
    private drainBuffer(): void {
        let progress = true;

        while (progress && this.rawBuffer.length > 0) {
            progress = false;

            if (this.inSyncBlock) {
                // Look for SYNC_END in accumulated buffer
                const endIdx = this.rawBuffer.indexOf(SYNC_END);
                if (endIdx !== -1) {
                    // Complete sync block found — mask and output
                    const block = this.rawBuffer.slice(0, endIdx + SYNC_END.length);
                    this.rawBuffer = this.rawBuffer.slice(endIdx + SYNC_END.length);
                    this.inSyncBlock = false;
                    this.maskAndOutput(block);
                    progress = true;
                }
                // else: SYNC_END not found yet — keep accumulating
            } else {
                // Look for SYNC_START in accumulated buffer
                const startIdx = this.rawBuffer.indexOf(SYNC_START);
                if (startIdx !== -1) {
                    // Output plain data before SYNC_START
                    if (startIdx > 0) {
                        this.maskAndOutput(this.rawBuffer.slice(0, startIdx));
                    }
                    this.rawBuffer = this.rawBuffer.slice(startIdx);
                    this.inSyncBlock = true;
                    progress = true;
                } else {
                    // No SYNC_START found — but the tail might be a PARTIAL marker
                    // e.g. buffer ends with "\x1b[?202" (incomplete SYNC_START)
                    // Hold back the last few chars that could be start of a marker
                    const safeEnd = this.rawBuffer.length - ShieldedTerminal.MARKER_MAX_LEN;
                    if (safeEnd > 0) {
                        this.maskAndOutput(this.rawBuffer.slice(0, safeEnd));
                        this.rawBuffer = this.rawBuffer.slice(safeEnd);
                        progress = true;
                    }
                    // else: buffer is small enough to hold entirely — wait for more
                }
            }
        }

        // Schedule flush for remaining buffer (handles non-sync shell output)
        if (this.rawBuffer.length > 0 && !this.inSyncBlock) {
            this.flushTimer = setTimeout(
                () => this.flushRemainingBuffer(),
                ShieldedTerminal.FLUSH_DELAY_MS,
            );
        }
    }

    /**
     * Mask a complete segment and output it.
     */
    private maskAndOutput(data: string): void {
        const result = maskTerminalOutput(data, this.patterns);
        if (result.output !== data) {
            this.maskedCount++;
            this.outputChannel.appendLine(`[Shield] Masked #${this.maskedCount}`);
        }
        this.writeEmitter.fire(result.output);
    }

    /**
     * Flush remaining buffer on timeout (for regular shell output).
     */
    private flushRemainingBuffer(): void {
        this.flushTimer = null;
        if (this.rawBuffer.length > 0 && !this.inSyncBlock) {
            this.maskAndOutput(this.rawBuffer);
            this.rawBuffer = '';
        }
    }
}

/**
 * FallbackShieldedTerminal — no native module dependency.
 * Uses child_process.spawn with basic line-mode I/O.
 * Limitations: no tab completion, no full PTY features.
 */
export class FallbackShieldedTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<number | void>();
    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

    private childProcess: any = null;
    private _shieldEnabled: boolean;
    private patterns: TerminalPattern[];
    private inputBuffer = '';

    constructor(
        private cwd: string,
        shieldEnabled: boolean,
        patterns: TerminalPattern[],
    ) {
        this._shieldEnabled = shieldEnabled;
        this.patterns = patterns;
    }

    get shieldEnabled(): boolean {
        return this._shieldEnabled;
    }

    set shieldEnabled(value: boolean) {
        this._shieldEnabled = value;
        const msg = value
            ? '\r\n Shield: ON \r\n'
            : '\r\n Shield: OFF \r\n';
        this.writeEmitter.fire(msg);
    }

    updatePatterns(patterns: TerminalPattern[]) {
        this.patterns = patterns;
    }

    async open(): Promise<void> {
        const { spawn } = require('child_process');
        const shell = getDefaultShell();

        this.childProcess = spawn(shell, [], {
            cwd: this.cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.childProcess.stdout.on('data', (data: Buffer) => {
            let text = data.toString();
            if (this._shieldEnabled) {
                const result = maskTerminalOutput(text, this.patterns);
                text = result.output;
            }
            this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
        });

        this.childProcess.stderr.on('data', (data: Buffer) => {
            let text = data.toString();
            if (this._shieldEnabled) {
                const result = maskTerminalOutput(text, this.patterns);
                text = result.output;
            }
            this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
        });

        this.childProcess.on('exit', (code: number) => {
            this.closeEmitter.fire(code);
        });

        this.writeEmitter.fire('[DemoSafe Shield - Fallback Mode] Terminal ready.\r\n$ ');
    }

    handleInput(data: string): void {
        if (!this.childProcess) { return; }

        if (data === '\r') {
            this.writeEmitter.fire('\r\n');
            this.childProcess.stdin.write(this.inputBuffer + '\n');
            this.inputBuffer = '';
        } else if (data === '\x7f') {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                this.writeEmitter.fire('\b \b');
            }
        } else if (data === '\x03') {
            this.childProcess.kill('SIGINT');
            this.inputBuffer = '';
            this.writeEmitter.fire('^C\r\n$ ');
        } else {
            this.inputBuffer += data;
            this.writeEmitter.fire(data);
        }
    }

    setDimensions(): void { }

    close(): void {
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
        }
    }
}

// --- Helpers ---

function getDefaultShell(): string {
    if (os.platform() === 'win32') {
        return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
}

/**
 * Load node-pty with triple-layer fallback:
 * 1. System npm install
 * 2. VS Code internal (node_modules.asar.unpacked)
 * 3. VS Code internal (node_modules)
 */
function loadNodePty(): any {
    try {
        return require('node-pty');
    } catch { /* continue */ }

    try {
        const ptyPath = path.join(
            vscode.env.appRoot,
            'node_modules.asar.unpacked',
            'node-pty'
        );
        return require(ptyPath);
    } catch { /* continue */ }

    try {
        const ptyPath = path.join(
            vscode.env.appRoot,
            'node_modules',
            'node-pty'
        );
        return require(ptyPath);
    } catch { /* continue */ }

    throw new Error('node-pty not found. Install it or use the fallback terminal.');
}
