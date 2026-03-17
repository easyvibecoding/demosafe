/**
 * Built-in API Key format detection regex library.
 * Independent of vault patterns — used for active key capture.
 * Vault patterns are specific to stored keys (exact match).
 * Capture patterns are generic format detectors (class match).
 *
 * Also includes platform-specific selectors for targeted DOM extraction
 * on known API console pages.
 */

// MARK: - Types

export interface CapturePattern {
    id: string;
    serviceName: string;
    prefix: string;
    regex: RegExp;
    confidence: number;   // base confidence 0.0-1.0
    minLength: number;    // minimum match length for validation
    platformSelectors?: PlatformSelector[];
}

export interface PlatformSelector {
    hostname: string;
    /** CSS selectors to query for key-containing elements */
    selectors: string[];
    /** Element attributes to read (default: textContent) */
    attributes?: string[];
    /** CSS selector for container to watch with MutationObserver (modal/dialog) */
    watchSelector?: string;
    /** Detection strategy */
    strategy: 'modal_watch' | 'attribute_read' | 'flash_notice' | 'reveal_toggle' | 'always_visible';
}

export interface CaptureMatch {
    rawValue: string;
    serviceName: string;
    patternId: string;
    confidence: number;
    captureMethod: 'dom_scan' | 'attribute_scan' | 'clipboard_intercept' | 'platform_selector';
}

// MARK: - Patterns with Platform Selectors

export const CAPTURE_PATTERNS: CapturePattern[] = [
    // OpenAI — project-scoped keys
    {
        id: 'openai-project',
        serviceName: 'OpenAI',
        prefix: 'sk-proj-',
        regex: /sk-proj-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 28,
        platformSelectors: [{
            hostname: 'platform.openai.com',
            selectors: [
                // Table: truncated key (for reference, won't match full regex)
                'td.api-key-token .api-key-token-value',
                // Modal: full key during creation (Radix UI)
                '[data-state="open"] input[type="text"]',
                '[data-state="open"] code',
                '[data-state="open"] [class*="token"]',
            ],
            watchSelector: '[data-state]',
            strategy: 'modal_watch',
        }],
    },
    // OpenAI — organization keys
    {
        id: 'openai-org',
        serviceName: 'OpenAI',
        prefix: 'sk-or-v1-',
        regex: /sk-or-v1-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 30,
        platformSelectors: [{
            hostname: 'platform.openai.com',
            selectors: ['[data-state="open"] input[type="text"]', '[data-state="open"] code'],
            watchSelector: '[data-state]',
            strategy: 'modal_watch',
        }],
    },
    // Anthropic
    {
        id: 'anthropic',
        serviceName: 'Anthropic',
        prefix: 'sk-ant-api03-',
        regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 34,
        platformSelectors: [
            {
                hostname: 'console.anthropic.com',
                selectors: ['[role="dialog"] code', '[role="dialog"] input', 'code.text-text-300'],
                watchSelector: '[role="dialog"]',
                strategy: 'modal_watch',
            },
            {
                hostname: 'platform.claude.com',
                selectors: ['[role="dialog"] code', '[role="dialog"] input', 'code.text-text-300'],
                watchSelector: '[role="dialog"]',
                strategy: 'modal_watch',
            },
        ],
    },
    // AWS Access Key ID
    {
        id: 'aws-access-key',
        serviceName: 'AWS',
        prefix: 'AKIA',
        regex: /AKIA[0-9A-Z]{16}/g,
        confidence: 0.90,
        minLength: 20,
        platformSelectors: [{
            hostname: 'console.aws.amazon.com',
            selectors: [
                '[class*="awsui_input"] input',
                '[class*="awsui_copy"]',
                'input[readonly]',
            ],
            attributes: ['value'],
            watchSelector: '[class*="awsui_modal"]',
            strategy: 'modal_watch',
        }],
    },
    // AWS Temporary Access Key
    {
        id: 'aws-temp-key',
        serviceName: 'AWS',
        prefix: 'ASIA',
        regex: /ASIA[0-9A-Z]{16}/g,
        confidence: 0.85,
        minLength: 20,
    },
    // Google Cloud API Key
    {
        id: 'google-cloud',
        serviceName: 'Google Cloud',
        prefix: 'AIzaSy',
        regex: /AIzaSy[A-Za-z0-9_-]{33}/g,
        confidence: 0.95,
        minLength: 39,
        platformSelectors: [{
            hostname: 'console.cloud.google.com',
            selectors: [
                'services-show-api-key-string',
                'mat-dialog-container input',
                'mat-dialog-container code',
            ],
            watchSelector: 'mat-dialog-container',
            strategy: 'reveal_toggle',
        }],
    },
    // Stripe Secret Key (live + test)
    {
        id: 'stripe-secret',
        serviceName: 'Stripe',
        prefix: 'sk_',
        regex: /sk_(?:test|live)_[a-zA-Z0-9]{24,}/g,
        confidence: 0.95,
        minLength: 32,
        platformSelectors: [{
            hostname: 'dashboard.stripe.com',
            selectors: ['input[type="text"][readonly]', 'input[type="text"]', 'code', 'span'],
            attributes: ['value'],
            strategy: 'reveal_toggle',
        }],
    },
    // Stripe Publishable Key
    {
        id: 'stripe-publishable',
        serviceName: 'Stripe',
        prefix: 'pk_',
        regex: /pk_(?:test|live)_[a-zA-Z0-9]{24,}/g,
        confidence: 0.90,
        minLength: 32,
        platformSelectors: [{
            hostname: 'dashboard.stripe.com',
            selectors: ['input[type="text"][readonly]', 'input[type="text"]'],
            attributes: ['value'],
            strategy: 'always_visible',
        }],
    },
    // Stripe Restricted Key
    {
        id: 'stripe-restricted',
        serviceName: 'Stripe',
        prefix: 'rk_',
        regex: /rk_(?:test|live)_[a-zA-Z0-9]{24,}/g,
        confidence: 0.90,
        minLength: 32,
    },
    // GitHub PAT (classic)
    {
        id: 'github-classic',
        serviceName: 'GitHub',
        prefix: 'ghp_',
        regex: /ghp_[A-Za-z0-9]{36}/g,
        confidence: 0.95,
        minLength: 40,
        platformSelectors: [{
            hostname: 'github.com',
            selectors: [
                'clipboard-copy[value]',   // Web Component with token in value attr
                '.flash code',             // Flash notice after creation
                '#new-oauth-token code',
            ],
            attributes: ['value'],         // Read value attribute from clipboard-copy
            watchSelector: '.flash',
            strategy: 'flash_notice',
        }],
    },
    // GitHub PAT (fine-grained)
    {
        id: 'github-fine-grained',
        serviceName: 'GitHub',
        prefix: 'github_pat_',
        regex: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
        confidence: 0.95,
        minLength: 93,
        platformSelectors: [{
            hostname: 'github.com',
            selectors: ['clipboard-copy[value]', '.flash code'],
            attributes: ['value'],
            watchSelector: '.flash',
            strategy: 'flash_notice',
        }],
    },
    // GitHub OAuth Token
    {
        id: 'github-oauth',
        serviceName: 'GitHub',
        prefix: 'gho_',
        regex: /gho_[A-Za-z0-9]{36}/g,
        confidence: 0.90,
        minLength: 40,
        platformSelectors: [{
            hostname: 'github.com',
            selectors: ['clipboard-copy[value]'],
            attributes: ['value'],
            strategy: 'flash_notice',
        }],
    },
    // Hugging Face
    {
        id: 'huggingface',
        serviceName: 'Hugging Face',
        prefix: 'hf_',
        regex: /hf_[a-zA-Z0-9]{30,}/g,
        confidence: 0.90,
        minLength: 33,
        platformSelectors: [{
            hostname: 'huggingface.co',
            selectors: [
                // Token creation page shows full token
                '.token-value code',
                'input[type="text"][readonly]',
                'code',
            ],
            watchSelector: '.flash, .notification, [role="alert"]',
            strategy: 'modal_watch',
        }],
    },
    // Slack Bot Token
    {
        id: 'slack-bot',
        serviceName: 'Slack',
        prefix: 'xoxb-',
        regex: /xoxb-[0-9]+-[A-Za-z0-9-]+/g,
        confidence: 0.90,
        minLength: 20,
        platformSelectors: [{
            hostname: 'api.slack.com',
            selectors: ['input[type="text"]', 'code', '.token_display'],
            attributes: ['value'],
            strategy: 'always_visible',
        }],
    },
    // Slack User Token
    {
        id: 'slack-user',
        serviceName: 'Slack',
        prefix: 'xoxp-',
        regex: /xoxp-[0-9]+-[A-Za-z0-9-]+/g,
        confidence: 0.90,
        minLength: 20,
        platformSelectors: [{
            hostname: 'api.slack.com',
            selectors: ['input[type="text"]', 'code', '.token_display'],
            attributes: ['value'],
            strategy: 'always_visible',
        }],
    },
    // Slack App-level Token
    {
        id: 'slack-app',
        serviceName: 'Slack',
        prefix: 'xapp-',
        regex: /xapp-[0-9]+-[A-Za-z0-9-]+/g,
        confidence: 0.90,
        minLength: 20,
    },
    // SendGrid
    {
        id: 'sendgrid',
        serviceName: 'SendGrid',
        prefix: 'SG.',
        regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
        confidence: 0.95,
        minLength: 69,
        platformSelectors: [{
            hostname: 'app.sendgrid.com',
            selectors: ['input[type="text"]', 'code', '[class*="api-key"]'],
            attributes: ['value'],
            strategy: 'modal_watch',
        }],
    },
    // GitLab PAT
    {
        id: 'gitlab-pat',
        serviceName: 'GitLab',
        prefix: 'glpat-',
        regex: /glpat-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.90,
        minLength: 26,
        platformSelectors: [{
            hostname: 'gitlab.com',
            selectors: ['input#created-personal-access-token', '.flash-notice code', 'clipboard-copy[value]'],
            attributes: ['value'],
            watchSelector: '.flash-notice',
            strategy: 'flash_notice',
        }],
    },
];

// MARK: - Domain Mapping

/**
 * Domain → pattern ID mapping for confidence boosting.
 */
export const DOMAIN_SERVICE_MAP: Record<string, string[]> = {
    'platform.openai.com': ['openai-project', 'openai-org'],
    'console.anthropic.com': ['anthropic'],
    'platform.claude.com': ['anthropic'],
    'github.com': ['github-classic', 'github-fine-grained', 'github-oauth'],
    'console.cloud.google.com': ['google-cloud'],
    'huggingface.co': ['huggingface'],
    'dashboard.stripe.com': ['stripe-secret', 'stripe-publishable', 'stripe-restricted'],
    'console.aws.amazon.com': ['aws-access-key', 'aws-temp-key'],
    'api.slack.com': ['slack-bot', 'slack-user', 'slack-app'],
    'app.sendgrid.com': ['sendgrid'],
    'gitlab.com': ['gitlab-pat'],
};

const DOMAIN_CONFIDENCE_BOOST = 0.05;
const DOMAIN_CONFIDENCE_PENALTY = -0.1;

// MARK: - Matching Functions

/**
 * Match text against all capture patterns.
 */
export function matchAgainstCapturePatterns(
    text: string,
    sourceHostname: string
): CaptureMatch[] {
    const matches: CaptureMatch[] = [];
    const domainPatterns = DOMAIN_SERVICE_MAP[sourceHostname] ?? [];

    // Skip truncated keys (contain ... or are too short)
    if (text.includes('...') && text.length < 30) return matches;

    for (const pattern of CAPTURE_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.regex.exec(text)) !== null) {
            const rawValue = match[0];
            if (rawValue.length < pattern.minLength) continue;
            // Skip truncated values
            if (rawValue.includes('...')) continue;

            let confidence = pattern.confidence;
            if (domainPatterns.includes(pattern.id)) {
                confidence = Math.min(1.0, confidence + DOMAIN_CONFIDENCE_BOOST);
            } else if (domainPatterns.length > 0) {
                confidence = Math.max(0.1, confidence + DOMAIN_CONFIDENCE_PENALTY);
            }

            matches.push({
                rawValue,
                serviceName: pattern.serviceName,
                patternId: pattern.id,
                confidence,
                captureMethod: 'dom_scan',
            });
        }
    }

    return matches;
}

/**
 * Get platform-specific selectors for the current hostname.
 */
export function getPlatformSelectors(hostname: string): Array<{
    pattern: CapturePattern;
    selector: PlatformSelector;
}> {
    const results: Array<{ pattern: CapturePattern; selector: PlatformSelector }> = [];
    for (const pattern of CAPTURE_PATTERNS) {
        if (!pattern.platformSelectors) continue;
        for (const ps of pattern.platformSelectors) {
            if (ps.hostname === hostname) {
                results.push({ pattern, selector: ps });
            }
        }
    }
    return results;
}

/**
 * Get all watch selectors for MutationObserver on this hostname.
 */
export function getWatchSelectors(hostname: string): string[] {
    const selectors = new Set<string>();
    for (const pattern of CAPTURE_PATTERNS) {
        if (!pattern.platformSelectors) continue;
        for (const ps of pattern.platformSelectors) {
            if (ps.hostname === hostname && ps.watchSelector) {
                selectors.add(ps.watchSelector);
            }
        }
    }
    return [...selectors];
}
