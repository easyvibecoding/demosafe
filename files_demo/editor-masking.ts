import * as vscode from 'vscode';
import { SecretPattern } from './patterns';

/**
 * EditorMasking
 * 負責在文字編輯器中用 Decoration API 遮蔽敏感資訊
 */
export class EditorMasking {
  private decorationType: vscode.TextEditorDecorationType;
  private enabled = false;

  constructor(private patterns: SecretPattern[]) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: '#ff000020',
      border: '1px solid #ff000050',
      borderRadius: '3px',
      color: 'transparent',
      after: {
        contentText: ' 🔒 ',
        color: '#ff6b6b',
        fontWeight: 'bold',
        fontSize: '0.85em',
      },
    });
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    if (value) {
      this.scanAllVisible();
    } else {
      this.clearAll();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updatePatterns(patterns: SecretPattern[]) {
    this.patterns = patterns;
  }

  /**
   * 掃描單一編輯器，回傳偵測到的數量
   */
  scan(editor: vscode.TextEditor): number {
    if (!this.enabled) { return 0; }

    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    for (const p of this.patterns) {
      p.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = p.regex.exec(text)) !== null) {
        const start = editor.document.positionAt(match.index);
        const end = editor.document.positionAt(match.index + match[0].length);
        decorations.push({
          range: new vscode.Range(start, end),
          hoverMessage: new vscode.MarkdownString(
            `🛡️ **Secret Shield**\n\n偵測到: **${p.name}**`
          ),
        });
      }
    }

    editor.setDecorations(this.decorationType, decorations);
    return decorations.length;
  }

  scanAllVisible() {
    for (const editor of vscode.window.visibleTextEditors) {
      this.scan(editor);
    }
  }

  clearAll() {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  dispose() {
    this.decorationType.dispose();
  }
}
