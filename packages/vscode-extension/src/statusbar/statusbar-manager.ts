import * as vscode from 'vscode';

export type ConnectionState = 'connected' | 'offline' | 'no-cache';

/**
 * Manages the status bar item showing DemoSafe state.
 *
 * States:
 * - Connected + Demo Mode: "$(shield) Demo-safe" with warning background
 * - Connected + Normal: "$(shield) Normal"
 * - Offline with cache: "$(shield) Demo-safe (Offline)"
 * - Offline without cache: "$(warning) Demo-safe (No Cache)"
 */
export class StatusBarManager {
    private item: vscode.StatusBarItem;
    private _connectionState: ConnectionState = 'offline';
    private _isDemoMode = false;
    private _contextName: string | null = null;
    private _maskedCount = 0;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'demosafe.toggleDemoMode';
        this.render();
        this.item.show();
    }

    /**
     * Update state and re-render the status bar item.
     */
    update(options: {
        isDemoMode?: boolean;
        connectionState?: ConnectionState;
        contextName?: string | null;
        maskedCount?: number;
    }) {
        if (options.isDemoMode !== undefined) this._isDemoMode = options.isDemoMode;
        if (options.connectionState !== undefined) this._connectionState = options.connectionState;
        if (options.contextName !== undefined) this._contextName = options.contextName;
        if (options.maskedCount !== undefined) this._maskedCount = options.maskedCount;
        this.render();
    }

    private render() {
        // Icon and label
        if (this._isDemoMode) {
            this.item.text = `$(shield) Demo-safe`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.item.text = `$(shield) Normal`;
            this.item.backgroundColor = undefined;
        }

        // Connection state suffix
        switch (this._connectionState) {
            case 'offline':
                this.item.text += ' (Offline)';
                break;
            case 'no-cache':
                this.item.text = '$(warning) Demo-safe (No Cache)';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'connected':
                // No suffix
                break;
        }

        // Tooltip with details
        const lines: string[] = ['DemoSafe API Key Manager'];
        lines.push(`Status: ${this._connectionState}`);
        lines.push(`Mode: ${this._isDemoMode ? 'Demo' : 'Normal'}`);
        if (this._contextName) {
            lines.push(`Context: ${this._contextName}`);
        }
        if (this._maskedCount > 0) {
            lines.push(`Masked keys in file: ${this._maskedCount}`);
        }
        this.item.tooltip = lines.join('\n');
    }

    dispose() {
        this.item.dispose();
    }
}
