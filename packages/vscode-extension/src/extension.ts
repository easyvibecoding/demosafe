import * as vscode from 'vscode';
import { IPCClient } from './ipc/ipc-client';
import { DecorationManager } from './decoration/decoration-manager';
import { StatusBarManager, ConnectionState } from './statusbar/statusbar-manager';
import { PatternScanner } from './core/pattern-scanner';
import { PatternCache } from './core/pattern-cache';
import { pasteKeyCommand } from './commands/paste-key';
import { ShieldedTerminal, FallbackShieldedTerminal } from './terminal/shielded-terminal';
import { buildTerminalPatterns } from './terminal/terminal-patterns';

let ipcClient: IPCClient;
let decorationManager: DecorationManager;
let statusBarManager: StatusBarManager;
let patternScanner: PatternScanner;
let patternCache: PatternCache;
let isDemoMode = false;
let isShieldActive = false;
let outputChannel: vscode.OutputChannel;

// Track all shielded terminals for state sync
const shieldedTerminals: Set<ShieldedTerminal | FallbackShieldedTerminal> = new Set();

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('DemoSafe');
    outputChannel.appendLine('[DemoSafe] Extension activating...');
    // Initialize modules
    patternCache = new PatternCache(context.globalState);
    patternScanner = new PatternScanner(patternCache);
    decorationManager = new DecorationManager();
    statusBarManager = new StatusBarManager();
    ipcClient = new IPCClient(patternCache);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('demosafe.toggleDemoMode', () => {
            if (ipcClient.isConnected) {
                ipcClient.sendRequest('get_state', {});
            } else {
                // Toggle local demo mode when offline
                isDemoMode = !isDemoMode;
                updateMasking();
            }
        }),
        vscode.commands.registerCommand('demosafe.pasteKey', () => {
            pasteKeyCommand(patternCache, ipcClient);
        }),
        vscode.commands.registerCommand('demosafe.openShieldedTerminal', () => {
            openShieldedTerminal();
        }),
        vscode.commands.registerCommand('demosafe.openTerminalWithCommand', async () => {
            const cmd = await vscode.window.showInputBox({
                prompt: 'Command to run in shielded terminal',
                placeHolder: 'e.g. claude, npm start, python app.py',
                value: 'claude',
            });
            if (cmd) {
                openShieldedTerminal(cmd);
            }
        }),
    );

    // IPC log forwarding
    ipcClient.on('log', (msg: string) => {
        outputChannel.appendLine(`[DemoSafe] ${msg}`);
    });

    // IPC event handlers
    ipcClient.on('connected', () => {
        outputChannel.appendLine('[DemoSafe] IPC connected!');
        updateConnectionState('connected');
    });

    ipcClient.on('disconnected', () => {
        outputChannel.appendLine('[DemoSafe] IPC disconnected');
        const state: ConnectionState = patternCache.hasCache() ? 'offline' : 'no-cache';
        updateConnectionState(state);
    });

    ipcClient.on('stateChanged', (state: { isDemoMode: boolean; activeContext: { name: string } | null }) => {
        isDemoMode = state.isDemoMode;
        isShieldActive = state.isDemoMode; // Sync shield with Demo Mode
        syncShieldState();
        statusBarManager.update({
            isDemoMode: state.isDemoMode,
            contextName: state.activeContext?.name ?? null,
        });
        updateMasking();
    });

    ipcClient.on('patternsUpdated', () => {
        updateMasking();
        // Update terminal patterns when Core syncs new patterns
        const patterns = buildTerminalPatterns(patternCache);
        for (const t of shieldedTerminals) {
            t.updatePatterns(patterns);
        }
    });

    ipcClient.on('clipboardCleared', () => {
        vscode.window.setStatusBarMessage('$(info) Clipboard auto-cleared by DemoSafe', 3000);
    });

    // Watch editor changes for live masking
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                scanAndDecorate(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                scanAndDecorate(editor);
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            for (const editor of editors) {
                scanAndDecorate(editor);
            }
        }),
    );

    // Track disposables
    context.subscriptions.push({
        dispose: () => {
            ipcClient.disconnect();
            decorationManager.dispose();
            statusBarManager.dispose();
        },
    });

    // Initial state
    const initialState: ConnectionState = patternCache.hasCache() ? 'offline' : 'no-cache';
    updateConnectionState(initialState);

    // Connect to Core
    ipcClient.connect();

    // Scan current editor
    if (vscode.window.activeTextEditor) {
        scanAndDecorate(vscode.window.activeTextEditor);
    }
}

/**
 * Scan the editor document and apply or clear decorations based on demo mode.
 */
function scanAndDecorate(editor: vscode.TextEditor) {
    if (!isDemoMode) {
        decorationManager.clear(editor);
        statusBarManager.update({ maskedCount: 0 });
        return;
    }

    const matches = patternScanner.scan(editor.document);
    decorationManager.apply(editor, matches);
    statusBarManager.update({ maskedCount: matches.length });
}

/**
 * Re-scan all visible editors after state or pattern changes.
 */
function updateMasking() {
    for (const editor of vscode.window.visibleTextEditors) {
        scanAndDecorate(editor);
    }
}

function updateConnectionState(state: ConnectionState) {
    statusBarManager.update({
        connectionState: state,
        isDemoMode,
    });

    if (state === 'no-cache') {
        vscode.window.showWarningMessage(
            'DemoSafe: No pattern cache available. Connect to Core to enable masking.'
        );
    }
}

// --- Shielded Terminal ---

function openShieldedTerminal(initialCommand?: string) {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || '/';
    const patterns = buildTerminalPatterns(patternCache);

    // Shielded Terminal always starts with shield ON — that's its purpose
    const shieldOn = true;
    let pty: ShieldedTerminal | FallbackShieldedTerminal;
    let terminalName: string;

    try {
        pty = new ShieldedTerminal(cwd, shieldOn, patterns, outputChannel);
        terminalName = 'Shield';
    } catch {
        pty = new FallbackShieldedTerminal(cwd, shieldOn, patterns);
        terminalName = 'Shield (Fallback)';
    }

    shieldedTerminals.add(pty);

    const terminal = vscode.window.createTerminal({
        name: terminalName,
        pty,
        location: vscode.TerminalLocation.Editor,
    });

    terminal.show();

    // Send initial command after shell starts
    if (initialCommand) {
        setTimeout(() => {
            for (const char of initialCommand) {
                pty.handleInput(char);
            }
            pty.handleInput('\r');
        }, 500);
    }
}

function syncShieldState() {
    for (const t of shieldedTerminals) {
        t.shieldEnabled = isShieldActive;
    }
}

export function deactivate() {
    for (const t of shieldedTerminals) {
        t.close();
    }
    shieldedTerminals.clear();
    ipcClient?.disconnect();
    decorationManager?.dispose();
    statusBarManager?.dispose();
}
