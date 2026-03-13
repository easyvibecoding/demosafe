import * as vscode from 'vscode';
import { IPCClient } from './ipc/ipc-client';
import { DecorationManager } from './decoration/decoration-manager';
import { StatusBarManager, ConnectionState } from './statusbar/statusbar-manager';
import { PatternScanner } from './core/pattern-scanner';
import { PatternCache } from './core/pattern-cache';
import { pasteKeyCommand } from './commands/paste-key';

let ipcClient: IPCClient;
let decorationManager: DecorationManager;
let statusBarManager: StatusBarManager;
let patternScanner: PatternScanner;
let patternCache: PatternCache;
let isDemoMode = false;
let outputChannel: vscode.OutputChannel;

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
        statusBarManager.update({
            isDemoMode: state.isDemoMode,
            contextName: state.activeContext?.name ?? null,
        });
        updateMasking();
    });

    ipcClient.on('patternsUpdated', () => {
        updateMasking();
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

export function deactivate() {
    ipcClient?.disconnect();
    decorationManager?.dispose();
    statusBarManager?.dispose();
}
