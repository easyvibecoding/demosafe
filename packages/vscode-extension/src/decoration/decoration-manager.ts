import * as vscode from 'vscode';
import { ScanMatch } from '../core/pattern-scanner';

/**
 * Manages VS Code text decorations for masking API keys.
 *
 * Uses Decoration API to:
 * 1. Hide the original key text (opacity: 0, letter-spacing collapses width)
 * 2. Overlay masked text via `after` pseudo-element
 * 3. Display tooltip on hover with service info
 */
export class DecorationManager {
    private _isActive = false;
    // One decoration type per unique masked text length to avoid overlap issues
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Apply masking decorations to the editor for all matched patterns.
     */
    apply(editor: vscode.TextEditor, matches: ScanMatch[]) {
        if (matches.length === 0) {
            this.clear(editor);
            return;
        }

        // Clear previous decorations
        this.disposeAllTypes();

        // Group matches by their masked text to reuse decoration types
        const groups = new Map<string, { match: ScanMatch; options: vscode.DecorationOptions }[]>();

        for (const match of matches) {
            // Pad masked text to match original length so nothing shifts
            const originalLen = match.range.end.character - match.range.start.character;
            const padded = padMaskedText(match.maskedText, originalLen);

            const key = padded;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push({
                match,
                options: {
                    range: match.range,
                    hoverMessage: new vscode.MarkdownString(
                        `🔒 **[Demo-safe]** \`${match.maskedText}\`\n\n` +
                        `*Service: ${match.serviceName}*`
                    ),
                },
            });
        }

        for (const [padded, entries] of groups) {
            const decorationType = vscode.window.createTextEditorDecorationType({
                // Hide original text completely
                opacity: '0',
                // Use negative letter-spacing to collapse the hidden text width
                letterSpacing: '-1em',
                // Render masked text as after pseudo-element
                after: {
                    contentText: padded,
                    color: new vscode.ThemeColor('editorWarning.foreground'),
                    fontStyle: 'normal',
                    // Use monospace to ensure consistent width
                    fontWeight: 'normal',
                },
                overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
                overviewRulerLane: vscode.OverviewRulerLane.Right,
            });

            this.decorationTypes.set(padded, decorationType);
            editor.setDecorations(decorationType, entries.map(e => e.options));
        }

        this._isActive = true;
    }

    /**
     * Remove all masking decorations from the editor.
     */
    clear(editor: vscode.TextEditor) {
        for (const [, type] of this.decorationTypes) {
            editor.setDecorations(type, []);
        }
        this._isActive = false;
    }

    /**
     * Clear decorations from all visible editors.
     */
    clearAll() {
        for (const editor of vscode.window.visibleTextEditors) {
            this.clear(editor);
        }
        this._isActive = false;
    }

    dispose() {
        this.disposeAllTypes();
    }

    private disposeAllTypes() {
        for (const [, type] of this.decorationTypes) {
            type.dispose();
        }
        this.decorationTypes.clear();
    }
}

/**
 * Pad masked text to match original key length using mask characters.
 * This prevents text shifting in the editor.
 */
function padMaskedText(masked: string, targetLen: number): string {
    if (masked.length >= targetLen) {
        return masked;
    }
    // Pad with mask char to fill the space
    const padCount = targetLen - masked.length;
    const midpoint = Math.floor(masked.length / 2);
    return masked.slice(0, midpoint) + '*'.repeat(padCount) + masked.slice(midpoint);
}
