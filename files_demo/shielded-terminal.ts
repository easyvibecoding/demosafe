import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { SecretPattern, maskSecrets } from './patterns';

/**
 * ShieldedTerminal
 *
 * 建立一個代理終端機：
 *   使用者輸入 → node-pty (真實 shell) → 輸出經過 maskSecrets 過濾 → 顯示在 VS Code
 *
 * 架構：
 *   [VS Code Terminal (Pseudoterminal)]
 *       ↕ handleInput() / onDidWrite
 *   [ShieldedTerminal - 這個類別]
 *       ↕ write() / onData()
 *   [node-pty (真實 shell 程序)]
 */
export class ShieldedTerminal implements vscode.Pseudoterminal {
  // 向 VS Code 終端寫入（顯示給使用者看的）
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  // 終端關閉事件
  private closeEmitter = new vscode.EventEmitter<number | void>();
  onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

  // 終端名稱變更
  private nameEmitter = new vscode.EventEmitter<string>();
  onDidChangeName: vscode.Event<string> = this.nameEmitter.event;

  // node-pty 程序
  private ptyProcess: any = null;

  // 是否啟用遮蔽
  private _shieldEnabled: boolean;

  // 使用的模式
  private patterns: SecretPattern[];

  // 偵測計數
  private maskedCount = 0;

  // 輸出日誌（供除錯）
  private outputChannel: vscode.OutputChannel;

  // 輸入緩衝區（處理密碼輸入模式）
  private inputBuffer = '';
  private isPasswordMode = false;

  constructor(
    private cwd: string,
    shieldEnabled: boolean,
    patterns: SecretPattern[],
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
    // 在終端中顯示狀態變更通知
    const msg = value
      ? '\r\n\x1b[42;30m 🛡️ Secret Shield: ON \x1b[0m\r\n'
      : '\r\n\x1b[43;30m 🔓 Secret Shield: OFF \x1b[0m\r\n';
    this.writeEmitter.fire(msg);
  }

  updatePatterns(patterns: SecretPattern[]) {
    this.patterns = patterns;
  }

  /**
   * VS Code 呼叫此方法來開啟終端
   */
  async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    const cols = initialDimensions?.columns || 80;
    const rows = initialDimensions?.rows || 30;

    try {
      // 動態載入 node-pty（因為它是原生模組）
      let pty: any;
      try {
        pty = require('node-pty');
      } catch {
        // 如果無法載入 node-pty，嘗試從 VS Code 內建的路徑載入
        // VS Code 本身打包了 node-pty
        try {
          const vscodeNodePtyPath = path.join(
            vscode.env.appRoot,
            'node_modules.asar.unpacked',
            'node-pty'
          );
          pty = require(vscodeNodePtyPath);
        } catch {
          // 最後嘗試
          const vscodeNodePtyPath2 = path.join(
            vscode.env.appRoot,
            'node_modules',
            'node-pty'
          );
          pty = require(vscodeNodePtyPath2);
        }
      }

      // 決定 shell
      const shell = this.shellPath || this.getDefaultShell();
      const args = this.shellArgs || [];

      this.outputChannel.appendLine(`[Terminal] Spawning shell: ${shell} ${args.join(' ')}`);
      this.outputChannel.appendLine(`[Terminal] CWD: ${this.cwd}`);
      this.outputChannel.appendLine(`[Terminal] Dimensions: ${cols}x${rows}`);

      // 用 node-pty 啟動真實 shell
      this.ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.cwd,
        env: { ...process.env } as { [key: string]: string },
      });

      // 攔截 shell 輸出 → 過濾敏感資訊 → 轉發給 VS Code 終端
      this.ptyProcess.onData((data: string) => {
        if (this._shieldEnabled) {
          const filtered = maskSecrets(data, this.patterns);
          if (filtered !== data) {
            this.maskedCount++;
            this.outputChannel.appendLine(`[Shield] Masked sensitive data in terminal output (#${this.maskedCount})`);
          }
          this.writeEmitter.fire(filtered);
        } else {
          this.writeEmitter.fire(data);
        }
      });

      // shell 結束時關閉終端
      this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        this.outputChannel.appendLine(`[Terminal] Shell exited with code ${exitCode}`);
        this.closeEmitter.fire(exitCode);
      });

      // 顯示歡迎訊息
      const statusText = this._shieldEnabled ? '🛡️ ON' : '🔓 OFF';
      this.writeEmitter.fire(
        `\x1b[90m[Secret Shield: ${statusText}] Terminal ready. Toggle with Ctrl+Shift+H\x1b[0m\r\n`
      );

    } catch (err: any) {
      this.outputChannel.appendLine(`[Terminal] ERROR: ${err.message}`);
      this.writeEmitter.fire(
        `\r\n\x1b[31m[Secret Shield] 無法啟動代理終端: ${err.message}\x1b[0m\r\n` +
        `\x1b[33m請確認 node-pty 已安裝。執行:\x1b[0m\r\n` +
        `\x1b[36m  cd <extension-path> && npm install node-pty\x1b[0m\r\n`
      );
      // 回退：打開一個普通終端的提示
      this.writeEmitter.fire(
        `\r\n\x1b[33m或者使用 "Secret Shield: Open Fallback Terminal" 命令來啟動基於 child_process 的終端。\x1b[0m\r\n`
      );
    }
  }

  /**
   * 使用者在終端中的輸入
   * 這裡也可以攔截輸入中的敏感資訊（但通常輸入不需要遮蔽，
   * 因為遮蔽的目的是防止觀眾看到輸出中的敏感資訊）
   */
  handleInput(data: string): void {
    if (!this.ptyProcess) { return; }

    // 偵測密碼輸入模式（例如 sudo 提示）
    // 在密碼模式下不回顯
    this.ptyProcess.write(data);
  }

  /**
   * 終端大小改變
   */
  setDimensions(dimensions: vscode.TerminalDimensions): void {
    if (this.ptyProcess) {
      this.ptyProcess.resize(dimensions.columns, dimensions.rows);
    }
  }

  /**
   * 關閉終端
   */
  close(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  /**
   * 取得目前系統預設 shell
   */
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * 取得已遮蔽的數量
   */
  getMaskedCount(): number {
    return this.maskedCount;
  }
}

/**
 * FallbackShieldedTerminal
 *
 * 不需要 node-pty 的備用方案
 * 使用 child_process.spawn 搭配基本的行模式
 * 限制：不支援完整的 PTY 功能（如 tab completion、顏色等較差）
 */
export class FallbackShieldedTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number | void>();
  onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

  private childProcess: any = null;
  private _shieldEnabled: boolean;
  private patterns: SecretPattern[];
  private inputBuffer = '';

  constructor(
    private cwd: string,
    shieldEnabled: boolean,
    patterns: SecretPattern[],
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
      ? '\r\n 🛡️ Secret Shield: ON \r\n'
      : '\r\n 🔓 Secret Shield: OFF \r\n';
    this.writeEmitter.fire(msg);
  }

  async open(): Promise<void> {
    const { spawn } = require('child_process');
    const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';

    this.childProcess = spawn(shell, [], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.childProcess.stdout.on('data', (data: Buffer) => {
      let text = data.toString();
      if (this._shieldEnabled) {
        text = maskSecrets(text, this.patterns);
      }
      this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
    });

    this.childProcess.stderr.on('data', (data: Buffer) => {
      let text = data.toString();
      if (this._shieldEnabled) {
        text = maskSecrets(text, this.patterns);
      }
      this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
    });

    this.childProcess.on('exit', (code: number) => {
      this.closeEmitter.fire(code);
    });

    this.writeEmitter.fire('[Secret Shield - Fallback Mode] Terminal ready.\r\n$ ');
  }

  handleInput(data: string): void {
    if (!this.childProcess) { return; }

    // 簡單的行模式處理
    if (data === '\r') {
      // Enter
      this.writeEmitter.fire('\r\n');
      this.childProcess.stdin.write(this.inputBuffer + '\n');
      this.inputBuffer = '';
    } else if (data === '\x7f') {
      // Backspace
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.writeEmitter.fire('\b \b');
      }
    } else if (data === '\x03') {
      // Ctrl+C
      this.childProcess.kill('SIGINT');
      this.inputBuffer = '';
      this.writeEmitter.fire('^C\r\n$ ');
    } else {
      // 正常字元
      this.inputBuffer += data;
      // 回顯（如果啟用 shield 且看起來像密碼輸入，就用 * 代替）
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
