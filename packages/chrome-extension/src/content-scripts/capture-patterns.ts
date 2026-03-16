/**
 * Built-in API Key format detection regex library.
 * Independent of vault patterns — used for active key capture.
 * Vault patterns are specific to stored keys (exact match).
 * Capture patterns are generic format detectors (class match).
 */

export interface CapturePattern {
    id: string;
    serviceName: string;
    prefix: string;
    regex: RegExp;
    confidence: number;   // base confidence 0.0-1.0
    minLength: number;    // minimum match length for validation
}

export interface CaptureMatch {
    rawValue: string;
    serviceName: string;
    patternId: string;
    confidence: number;
    captureMethod: 'dom_scan' | 'attribute_scan' | 'clipboard_intercept';
}

export const CAPTURE_PATTERNS: CapturePattern[] = [
    // OpenAI — project-scoped keys
    {
        id: 'openai-project',
        serviceName: 'OpenAI',
        prefix: 'sk-proj-',
        regex: /sk-proj-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 28,
    },
    // OpenAI — organization keys
    {
        id: 'openai-org',
        serviceName: 'OpenAI',
        prefix: 'sk-or-v1-',
        regex: /sk-or-v1-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 30,
    },
    // Anthropic
    {
        id: 'anthropic',
        serviceName: 'Anthropic',
        prefix: 'sk-ant-api03-',
        regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.95,
        minLength: 34,
    },
    // AWS Access Key ID
    {
        id: 'aws-access-key',
        serviceName: 'AWS',
        prefix: 'AKIA',
        regex: /AKIA[0-9A-Z]{16}/g,
        confidence: 0.90,
        minLength: 20,
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
    },
    // Stripe Secret Key (live + test)
    {
        id: 'stripe-secret',
        serviceName: 'Stripe',
        prefix: 'sk_',
        regex: /sk_(?:test|live)_[a-zA-Z0-9]{24,}/g,
        confidence: 0.95,
        minLength: 32,
    },
    // Stripe Publishable Key
    {
        id: 'stripe-publishable',
        serviceName: 'Stripe',
        prefix: 'pk_',
        regex: /pk_(?:test|live)_[a-zA-Z0-9]{24,}/g,
        confidence: 0.90,
        minLength: 32,
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
    },
    // GitHub PAT (fine-grained)
    {
        id: 'github-fine-grained',
        serviceName: 'GitHub',
        prefix: 'github_pat_',
        regex: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
        confidence: 0.95,
        minLength: 93,
    },
    // GitHub OAuth Token
    {
        id: 'github-oauth',
        serviceName: 'GitHub',
        prefix: 'gho_',
        regex: /gho_[A-Za-z0-9]{36}/g,
        confidence: 0.90,
        minLength: 40,
    },
    // Hugging Face
    {
        id: 'huggingface',
        serviceName: 'Hugging Face',
        prefix: 'hf_',
        regex: /hf_[a-zA-Z0-9]{30,}/g,
        confidence: 0.90,
        minLength: 33,
    },
    // Slack Bot Token
    {
        id: 'slack-bot',
        serviceName: 'Slack',
        prefix: 'xoxb-',
        regex: /xoxb-[0-9]+-[A-Za-z0-9-]+/g,
        confidence: 0.90,
        minLength: 20,
    },
    // Slack User Token
    {
        id: 'slack-user',
        serviceName: 'Slack',
        prefix: 'xoxp-',
        regex: /xoxp-[0-9]+-[A-Za-z0-9-]+/g,
        confidence: 0.90,
        minLength: 20,
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
    },
    // GitLab PAT
    {
        id: 'gitlab-pat',
        serviceName: 'GitLab',
        prefix: 'glpat-',
        regex: /glpat-[A-Za-z0-9_-]{20,}/g,
        confidence: 0.90,
        minLength: 26,
    },
];

/**
 * Domain → pattern ID mapping for confidence boosting.
 * If a key is detected on its expected domain, confidence is boosted.
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

const DOMAIN_CONFIDENCE_BOOST = 0.05;  // boost when on expected domain
const DOMAIN_CONFIDENCE_PENALTY = -0.1; // penalty when on unexpected domain

/**
 * Match text against all capture patterns.
 * Returns all matches with confidence scores adjusted by domain context.
 */
export function matchAgainstCapturePatterns(
    text: string,
    sourceHostname: string
): CaptureMatch[] {
    const matches: CaptureMatch[] = [];
    const domainPatterns = DOMAIN_SERVICE_MAP[sourceHostname] ?? [];

    for (const pattern of CAPTURE_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.regex.exec(text)) !== null) {
            const rawValue = match[0];
            if (rawValue.length < pattern.minLength) continue;

            // Adjust confidence based on domain
            let confidence = pattern.confidence;
            if (domainPatterns.includes(pattern.id)) {
                confidence = Math.min(1.0, confidence + DOMAIN_CONFIDENCE_BOOST);
            } else if (domainPatterns.length > 0) {
                // We're on a known API domain but this pattern doesn't match it
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
