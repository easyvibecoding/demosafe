import * as vscode from 'vscode';
import { BUILTIN_PATTERNS, SecretPattern } from './patterns';
import { ShieldedTerminal, FallbackShieldedTerminal } from './shielded-terminal';
import { EditorMasking } from './editor-masking';

// ============================================================
// Secret Shield - 主動防禦
//
// 兩層防護：
//   1. Terminal Proxy：用 node-pty 代理 shell，攔截輸出並替換敏感資訊
//   2. Editor Decoration：在編輯器中用裝飾遮蔽敏感文字
// ============================================================

let isShieldActive = false;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let editorMasking: EditorMasking;
let customPatterns: SecretPattern[] = [];
let allPatterns: SecretPattern[] = [];

// 追蹤所有 shielded terminals，用於同步開關狀態
const shieldedTerminals: Set<ShieldedTerminal | FallbackShieldedTerminal> = new Set();

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Secret Shield');
  outputChannel.appendLine('[Secret Shield] 擴充套件已啟動');

  // 載入模式
  loadCustomPatterns();
  allPatterns = [...BUILTIN_PATTERNS, ...customPatterns];

  // 初始化編輯器遮蔽
  editorMasking = new EditorMasking(allPatterns);

  // 狀態列
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'secretShield.toggle';
  updateStatusBar();
  statusBarItem.show();

  // ============================================================
  // 命令
  // ============================================================

  // 1) 切換 Shield 開關
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.toggle', () => {
      isShieldActive = !isShieldActive;
      syncShieldState();
      const msg = isShieldActive
        ? '🛡️ Secret Shield 已啟用 — 終端輸出及編輯器中的敏感資訊將被遮蔽'
        : '🔓 Secret Shield 已停用';
      vscode.window.showInformationMessage(msg);
    })
  );

  // 2) 開啟受保護的終端（主功能）
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.openTerminal', () => {
      openShieldedTerminal(context);
    })
  );

  // 3) 開啟受保護的終端並執行指令（例如 claude）
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.openTerminalWithCommand', async () => {
      const cmd = await vscode.window.showInputBox({
        prompt: '輸入要在受保護終端中執行的命令',
        placeHolder: '例如: claude, npm start, python app.py',
        value: 'claude',
      });
      if (cmd) {
        openShieldedTerminal(context, cmd);
      }
    })
  );

  // 4) 展示模式 — 一鍵啟用 + 開終端
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.presentationMode', () => {
      isShieldActive = true;
      syncShieldState();
      openShieldedTerminal(context);
      vscode.window.showInformationMessage('🎬 展示模式已啟用 — 所有敏感資訊已遮蔽');
    })
  );

  // 5) 備用終端（不需要 node-pty）
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.openFallbackTerminal', () => {
      openFallbackTerminal();
    })
  );

  // 6) 掃描當前檔案
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.scanCurrent', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editorMasking.setEnabled(true);
        const count = editorMasking.scan(editor);
        vscode.window.showInformationMessage(`🔍 掃描完成：發現 ${count} 個敏感資訊`);
      }
    })
  );

  // 7) 新增自訂模式
  context.subscriptions.push(
    vscode.commands.registerCommand('secretShield.addPattern', async () => {
      const name = await vscode.window.showInputBox({ prompt: '模式名稱' });
      if (!name) { return; }
      const regex = await vscode.window.showInputBox({ prompt: '正則表達式' });
      if (!regex) { return; }
      const mask = await vscode.window.showInputBox({ prompt: '遮蔽文字', value: '••••••••••' });

      try {
        new RegExp(regex, 'g'); // 驗證
        const config = vscode.workspace.getConfiguration('secretShield');
        const existing = config.get<any[]>('customPatterns') || [];
        existing.push({ name, regex, mask });
        await config.update('customPatterns', existing, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`✅ 已新增自訂模式: ${name}`);
      } catch (e) {
        vscode.window.showErrorMessage(`❌ 正則表達式無效: ${e}`);
      }
    })
  );

  // ============================================================
  // 事件
  // ============================================================

  // 編輯器切換
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isShieldActive && editor) {
        editorMasking.scan(editor);
      }
    })
  );

  // 文件變更（防抖）
  let debounce: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isShieldActive) { return; }
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        if (debounce) { clearTimeout(debounce); }
        debounce = setTimeout(() => editorMasking.scan(editor), 300);
      }
    })
  );

  // 設定變更
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('secretShield')) {
        loadCustomPatterns();
        allPatterns = [...BUILTIN_PATTERNS, ...customPatterns];
        editorMasking.updatePatterns(allPatterns);
        for (const t of shieldedTerminals) {
          if (t instanceof ShieldedTerminal) {
            t.updatePatterns(allPatterns);
          }
        }
        if (isShieldActive) {
          editorMasking.scanAllVisible();
        }
      }
    })
  );

  // 終端關閉時清理
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => {
      // 清理已關閉的 terminal 參考
      // （ShieldedTerminal 的 close() 會被呼叫，但 Set 中的參考需要清理）
    })
  );

  // 自動啟用
  const config = vscode.workspace.getConfiguration('secretShield');
  if (config.get<boolean>('autoEnable')) {
    isShieldActive = true;
    syncShieldState();
  }

  context.subscriptions.push(statusBarItem, outputChannel);
}

// ============================================================
// 開啟受保護的代理終端
// ============================================================
function openShieldedTerminal(context: vscode.ExtensionContext, initialCommand?: string) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || '/';
  const config = vscode.workspace.getConfiguration('secretShield');
  const shellPath = config.get<string>('shellPath') || undefined;
  const shellArgs = config.get<string[]>('shellArgs') || undefined;

  const shieldedPty = new ShieldedTerminal(
    cwd,
    isShieldActive,
    allPatterns,
    outputChannel,
    shellPath,
    shellArgs,
  );

  shieldedTerminals.add(shieldedPty);

  const terminal = vscode.window.createTerminal({
    name: `🛡️ Shield${isShieldActive ? ' (ON)' : ''}`,
    pty: shieldedPty,
  });

  terminal.show();

  // 如果有初始命令，延遲一點再發送（等 shell 啟動）
  if (initialCommand) {
    setTimeout(() => {
      // 透過 pty 的 handleInput 發送命令
      for (const char of initialCommand) {
        shieldedPty.handleInput(char);
      }
      shieldedPty.handleInput('\r');
    }, 500);
  }
}

// ============================================================
// 備用終端
// ============================================================
function openFallbackTerminal() {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || '/';

  const fallbackPty = new FallbackShieldedTerminal(cwd, isShieldActive, allPatterns);
  shieldedTerminals.add(fallbackPty);

  const terminal = vscode.window.createTerminal({
    name: '🛡️ Shield (Fallback)',
    pty: fallbackPty,
  });

  terminal.show();
}

// ============================================================
// 同步所有 shield 狀態
// ============================================================
function syncShieldState() {
  // 同步到所有終端
  for (const t of shieldedTerminals) {
    t.shieldEnabled = isShieldActive;
  }

  // 同步到編輯器
  editorMasking.setEnabled(isShieldActive);

  updateStatusBar();
}

// ============================================================
// 狀態列
// ============================================================
function updateStatusBar() {
  if (isShieldActive) {
    statusBarItem.text = '$(shield) Shield: ON';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = '點擊停用 Secret Shield';
  } else {
    statusBarItem.text = '$(unlock) Shield: OFF';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = '點擊啟用 Secret Shield';
  }
}

// ============================================================
// 載入自訂模式
// ============================================================
function loadCustomPatterns() {
  const config = vscode.workspace.getConfiguration('secretShield');
  const raw = config.get<any[]>('customPatterns') || [];

  customPatterns = raw
    .filter(p => p.name && p.regex)
    .map(p => {
      try {
        return { name: p.name, regex: new RegExp(p.regex, 'g'), mask: p.mask || '••••••••••' };
      } catch {
        outputChannel.appendLine(`[警告] 無效的自訂模式: ${p.name}`);
        return null;
      }
    })
    .filter((p): p is SecretPattern => p !== null);

  outputChannel.appendLine(`[設定] 載入 ${customPatterns.length} 個自訂模式`);
}

export function deactivate() {
  for (const t of shieldedTerminals) {
    if (t instanceof ShieldedTerminal) {
      t.close();
    }
  }
  shieldedTerminals.clear();
  editorMasking?.dispose();
}
