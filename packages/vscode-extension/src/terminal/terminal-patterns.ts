import { PatternCache } from '../core/pattern-cache';

export interface TerminalPattern {
    name: string;
    regex: RegExp;
    mask: string;
}

/**
 * Built-in patterns for terminal output masking.
 * Covers common API key formats and sensitive data that may appear in CLI output.
 * Each regex uses /g flag and must have lastIndex reset before use.
 */
export const BUILTIN_TERMINAL_PATTERNS: TerminalPattern[] = [
    // Anthropic
    { name: 'Anthropic API Key', regex: /sk-ant-api03-[a-zA-Z0-9_-]{20,}/g, mask: 'sk-ant-••••••••••' },
    { name: 'Anthropic API Key (short)', regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g, mask: 'sk-ant-••••••••••' },
    // OpenAI
    { name: 'OpenAI API Key', regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g, mask: 'sk-proj-••••••••••' },
    { name: 'OpenAI API Key (generic)', regex: /sk-[a-zA-Z0-9_-]{30,}/g, mask: 'sk-••••••••••' },
    // GitHub
    { name: 'GitHub Token (PAT)', regex: /ghp_[A-Za-z0-9]{36,}/g, mask: 'ghp_••••••••••' },
    { name: 'GitHub Token (OAuth)', regex: /gho_[A-Za-z0-9]{36,}/g, mask: 'gho_••••••••••' },
    { name: 'GitHub Token (User)', regex: /ghu_[A-Za-z0-9]{36,}/g, mask: 'ghu_••••••••••' },
    { name: 'GitHub Token (Server)', regex: /ghs_[A-Za-z0-9]{36,}/g, mask: 'ghs_••••••••••' },
    { name: 'GitHub Token (Refresh)', regex: /ghr_[A-Za-z0-9]{36,}/g, mask: 'ghr_••••••••••' },
    // GitLab
    { name: 'GitLab Token', regex: /glpat-[A-Za-z0-9_-]{20,}/g, mask: 'glpat-••••••••••' },
    // AWS
    { name: 'AWS Access Key', regex: /AKIA[A-Z0-9]{16}/g, mask: 'AKIA••••••••••••' },
    { name: 'AWS Temp Key', regex: /ASIA[A-Z0-9]{16}/g, mask: 'ASIA••••••••••••' },
    { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?([a-zA-Z0-9/+]{40})['"]?/gi, mask: 'AWS_SECRET=••••••••••' },
    // Google Cloud
    { name: 'Google API Key', regex: /AIzaSy[0-9A-Za-z_-]{33}/g, mask: 'AIza••••••••••' },
    // Slack
    { name: 'Slack Token', regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/g, mask: 'xox•-••••••••••' },
    // HuggingFace
    { name: 'HuggingFace Token', regex: /hf_[A-Za-z0-9]{20,}/g, mask: 'hf_••••••••••' },
    // Stripe
    { name: 'Stripe Secret Key', regex: /sk_live_[A-Za-z0-9]{20,}/g, mask: 'sk_live_••••••••••' },
    { name: 'Stripe Test Key', regex: /sk_test_[A-Za-z0-9]{20,}/g, mask: 'sk_test_••••••••••' },
    // SendGrid
    { name: 'SendGrid API Key', regex: /SG\.[A-Za-z0-9_-]{20,}/g, mask: 'SG.••••••••••' },
    // Bearer Token (curl -H "Authorization: Bearer ...")
    { name: 'Bearer Token', regex: /Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, mask: 'Bearer ••••••••••' },
    // JWT Token
    { name: 'JWT Token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, mask: 'eyJ••••.eyJ••••.••••' },
    // Private Key block
    { name: 'Private Key', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, mask: '-----[PRIVATE KEY REDACTED]-----' },
    // Connection strings
    { name: 'Connection String', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi, mask: '••://••••••••••' },
    // Password in config
    { name: 'Password', regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi, mask: 'password=••••••••••' },
    // Generic key=value (long hex tokens)
    { name: 'Hex Token', regex: /(?:token|secret|key|api_key|apikey)\s*[:=]\s*['"]?([0-9a-fA-F]{32,})['"]?/gi, mask: 'token=••••••••••' },
];

/**
 * Build the full pattern list by merging built-in patterns with
 * Core-synced patterns from PatternCache.
 */
export function buildTerminalPatterns(cache: PatternCache): TerminalPattern[] {
    const patterns = [...BUILTIN_TERMINAL_PATTERNS];

    // Add patterns from Core (stored keys)
    for (const entry of cache.getPatterns()) {
        try {
            patterns.push({
                name: `${entry.serviceName} (${entry.keyId.slice(0, 8)})`,
                regex: new RegExp(entry.pattern, 'g'),
                mask: entry.maskedPreview,
            });
        } catch {
            // Skip invalid patterns
        }
    }

    return patterns;
}

/**
 * Regex matching ANSI escape codes AND all whitespace.
 *
 * API keys never contain whitespace. Terminal renderers (Ink) insert
 * \r\n, indentation spaces, cursor positioning, and padding when
 * word-wrapping long lines. Stripping ALL whitespace alongside ANSI
 * codes produces a collapsed text where regex can match keys that
 * span multiple visual lines with arbitrary formatting in between.
 */
// eslint-disable-next-line no-control-regex
const ANSI_AND_STRUCTURAL_REGEX = new RegExp('\x1B\\[[0-9;]*[A-Za-z]|\x1B\\][^\x07]*\x07|\x1B[()][AB012]|\x1B\\[[?]?[0-9;]*[hlm]|[\\s]+', 'g');

export interface MaskResult {
    output: string;
    /** True if a match extends to the very end of the text (possibly truncated key) */
    hasTrailingMatch: boolean;
}

/**
 * Mask sensitive data in terminal output.
 * ANSI-aware: strips ANSI codes for pattern matching, then replaces
 * only the matched key portions in the original data while preserving
 * all surrounding ANSI formatting.
 *
 * Fast path: if no patterns match, returns original data unchanged.
 */
export function maskTerminalOutput(data: string, patterns: TerminalPattern[]): MaskResult {
    // Build a mapping from plain-text positions to original-data positions
    // so we can replace only the matched portions in the original string
    const ansiPositions: { origStart: number; origEnd: number }[] = [];
    let match: RegExpExecArray | null;
    const ansiRe = new RegExp(ANSI_AND_STRUCTURAL_REGEX.source, 'g');

    while ((match = ansiRe.exec(data)) !== null) {
        ansiPositions.push({ origStart: match.index, origEnd: match.index + match[0].length });
    }

    // Build plain text and position map (plain index → original index)
    const plainToOrig: number[] = [];
    let plainText = '';
    let origIdx = 0;
    let ansiIdx = 0;

    while (origIdx < data.length) {
        // Skip ANSI sequences
        if (ansiIdx < ansiPositions.length && origIdx === ansiPositions[ansiIdx].origStart) {
            origIdx = ansiPositions[ansiIdx].origEnd;
            ansiIdx++;
            continue;
        }
        plainToOrig.push(origIdx);
        plainText += data[origIdx];
        origIdx++;
    }

    // Find all matches in plain text
    interface MatchInfo { plainStart: number; plainEnd: number; mask: string }
    const allMatches: MatchInfo[] = [];

    for (const p of patterns) {
        p.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = p.regex.exec(plainText)) !== null) {
            allMatches.push({
                plainStart: m.index,
                plainEnd: m.index + m[0].length,
                mask: p.mask,
            });
            if (m[0].length === 0) { p.regex.lastIndex++; }
        }
    }

    if (allMatches.length === 0) {
        return { output: data, hasTrailingMatch: false }; // Fast path: no changes
    }

    // Sort matches by position, resolve overlaps (longest wins)
    allMatches.sort((a, b) => a.plainStart - b.plainStart);
    const resolved: MatchInfo[] = [allMatches[0]];
    for (let i = 1; i < allMatches.length; i++) {
        const curr = allMatches[i];
        const last = resolved[resolved.length - 1];
        if (curr.plainStart < last.plainEnd) {
            if ((curr.plainEnd - curr.plainStart) > (last.plainEnd - last.plainStart)) {
                resolved[resolved.length - 1] = curr;
            }
        } else {
            resolved.push(curr);
        }
    }

    // Check if any match extends to the very end of the plain text
    // (possibly a truncated key that continues in the next chunk)
    const lastMatch = resolved[resolved.length - 1];
    const hasTrailingMatch = lastMatch.plainEnd >= plainText.length;

    // Replace in original string (from end to start to preserve positions)
    let result = data;
    for (let i = resolved.length - 1; i >= 0; i--) {
        const m = resolved[i];
        const origStart = plainToOrig[m.plainStart];
        const origEnd = m.plainEnd < plainToOrig.length
            ? plainToOrig[m.plainEnd]
            : data.length;

        // Preserve ANSI codes and line breaks within the matched range.
        // This maintains terminal layout when a key spans multiple visual lines.
        const matchedOriginal = data.slice(origStart, origEnd);
        // eslint-disable-next-line no-control-regex
        const hasStructural = /[\x1b\r\n]/.test(matchedOriginal);
        const structural = hasStructural ? extractStructural(matchedOriginal) : '';

        result = result.slice(0, origStart) + m.mask + structural + result.slice(origEnd);
    }

    return { output: result, hasTrailingMatch };
}

/**
 * Extract ANSI escape codes and line breaks from a string,
 * preserving their order. This allows us to maintain terminal
 * layout (line breaks, colors, cursor positioning) after replacing
 * key text with a shorter mask.
 */
function extractStructural(text: string): string {
    const parts: string[] = [];
    ANSI_AND_STRUCTURAL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANSI_AND_STRUCTURAL_REGEX.exec(text)) !== null) {
        parts.push(m[0]);
    }
    return parts.join('');
}
