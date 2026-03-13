// ============================================================
// 敏感資訊偵測模式定義
// ============================================================

export interface SecretPattern {
  name: string;
  regex: RegExp;
  mask: string;
}

/**
 * 內建的敏感資訊偵測模式
 * 每次使用前必須 reset lastIndex（因為 /g flag）
 */
export const BUILTIN_PATTERNS: SecretPattern[] = [
  // Anthropic API Key
  { name: 'Anthropic API Key', regex: /sk-ant-[a-zA-Z0-9\-_]{20,}/g, mask: 'sk-ant-••••••••••' },
  // OpenAI API Key
  { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{20,}/g, mask: 'sk-••••••••••' },
  // Generic API Key in key=value format
  { name: 'API Key (generic)', regex: /(?:api[_-]?key|apikey|api[_-]?token)\s*[:=]\s*['"]?([a-zA-Z0-9\-_]{20,})['"]?/gi, mask: 'API_KEY=••••••••••' },
  // Bearer Token
  { name: 'Bearer Token', regex: /Bearer\s+[a-zA-Z0-9\-_\.]{20,}/gi, mask: 'Bearer ••••••••••' },
  // AWS Access Key
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, mask: 'AKIA••••••••••••' },
  // AWS Secret Key
  { name: 'AWS Secret Key', regex: /(?:aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9\/\+]{40})['"]?/gi, mask: 'AWS_SECRET=••••••••••' },
  // GitHub Token
  { name: 'GitHub Token', regex: /gh[ps]_[A-Za-z0-9_]{36,}/g, mask: 'ghp_••••••••••' },
  // Google API Key
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z\-_]{35}/g, mask: 'AIza••••••••••' },
  // Slack Token
  { name: 'Slack Token', regex: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g, mask: 'xox•-••••••••••' },
  // Private Key block
  { name: 'Private Key', regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, mask: '-----[PRIVATE KEY REDACTED]-----' },
  // Password in config (password=xxx, secret=xxx)
  { name: 'Password', regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi, mask: 'password=••••••••••' },
  // Connection strings
  { name: 'Connection String', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi, mask: '••://••••••••••' },
  // JWT tokens
  { name: 'JWT Token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, mask: 'eyJ••••.eyJ••••.••••' },
  // Hex tokens (token=abc123...)
  { name: 'Hex Token', regex: /(?:token|secret|key)\s*[:=]\s*['"]?([0-9a-fA-F]{32,})['"]?/gi, mask: 'token=••••••••••' },
];

/**
 * 對文字進行敏感資訊替換
 * @param text   原始文字
 * @param patterns  要使用的模式列表
 * @returns 替換後的文字
 */
export function maskSecrets(text: string, patterns: SecretPattern[]): string {
  let result = text;
  for (const p of patterns) {
    // 每次使用前重置 lastIndex
    p.regex.lastIndex = 0;
    result = result.replace(p.regex, p.mask);
  }
  return result;
}

/**
 * 檢查文字中是否包含敏感資訊
 */
export function containsSecrets(text: string, patterns: SecretPattern[]): boolean {
  for (const p of patterns) {
    p.regex.lastIndex = 0;
    if (p.regex.test(text)) {
      return true;
    }
  }
  return false;
}
