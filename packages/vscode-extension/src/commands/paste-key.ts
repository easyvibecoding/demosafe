import * as vscode from 'vscode';
import { PatternCache } from '../core/pattern-cache';
import { IPCClient } from '../ipc/ipc-client';

/**
 * Command: demosafe.pasteKey
 * Shows a quick pick to select a key, then requests paste via Core.
 */
export async function pasteKeyCommand(cache: PatternCache, ipcClient: IPCClient) {
    if (!ipcClient.isConnected) {
        vscode.window.showWarningMessage('DemoSafe: Not connected to Core. Cannot paste keys.');
        return;
    }

    const patterns = cache.getPatterns();
    if (patterns.length === 0) {
        vscode.window.showInformationMessage('DemoSafe: No keys configured. Add keys in the DemoSafe app.');
        return;
    }

    const items = patterns.map(p => ({
        label: `$(key) ${p.serviceName}`,
        description: p.maskedPreview,
        detail: `Key ID: ${p.keyId}`,
        keyId: p.keyId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a key to paste to clipboard',
        matchOnDescription: true,
    });

    if (!selected) return;

    const success = await ipcClient.requestPaste(selected.keyId);
    if (success) {
        vscode.window.setStatusBarMessage('$(check) Key copied to clipboard', 3000);
    } else {
        vscode.window.showErrorMessage('DemoSafe: Failed to paste key. Check if Core is running.');
    }
}

/**
 * Command: demosafe.pasteKeyByIndex
 * Paste key by position index (1-9), matching ⌃⌥⌘[1-9] hotkey in Core.
 */
export async function pasteKeyByIndexCommand(index: number, cache: PatternCache, ipcClient: IPCClient) {
    if (!ipcClient.isConnected) return;

    const patterns = cache.getPatterns();
    if (index < 1 || index > patterns.length) return;

    const keyId = patterns[index - 1].keyId;
    const success = await ipcClient.requestPaste(keyId);
    if (success) {
        vscode.window.setStatusBarMessage(`$(check) Key #${index} copied`, 2000);
    }
}
