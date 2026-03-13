/**
 * Content script — scans and masks API keys on known API console pages.
 *
 * Strategy:
 * 1. CSS overlay approach: wrap matched text in <span> with visual masking
 * 2. Store originals for unmask capability
 * 3. MutationObserver for dynamic content (SPAs, lazy-loaded elements)
 * 4. Debounce observer callbacks to avoid excessive re-scanning
 */

interface PatternEntry {
    keyId: string;
    serviceId: string;
    serviceName: string;
    pattern: string;
    maskedPreview: string;
}

interface MaskRecord {
    element: HTMLElement;
    originalText: string;
    keyId: string;
}

const MASK_ATTR = 'data-demosafe-masked';
const MASK_CLASS = 'demosafe-mask';

let patterns: PatternEntry[] = [];
const compiledPatterns: Map<string, RegExp> = new Map();
let isDemoMode = false;
let maskRecords: MaskRecord[] = [];
let observer: MutationObserver | null = null;
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// MARK: - Initialization

// Inject masking CSS
const style = document.createElement('style');
style.textContent = `
  .${MASK_CLASS} {
    background-color: #1a1a2e;
    color: #e94560;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: inherit;
    letter-spacing: 0.5px;
    user-select: none;
    cursor: default;
  }
  .${MASK_CLASS}:hover::after {
    content: ' 🔒';
    font-size: 0.8em;
  }
`;
document.head.appendChild(style);

// Load cached patterns from storage
chrome.storage.local.get(['patternCache'], (result) => {

    if (result.patternCache?.patternArray) {
        updatePatterns(result.patternCache.patternArray);
    }
});

// MARK: - Message Handling

chrome.runtime.onMessage.addListener((message) => {

    if (!message.action) return;

    switch (message.action) {
        case 'state_changed':
            isDemoMode = message.payload?.isDemoMode ?? false;

            if (isDemoMode) {
                scanAndMask();
            } else {
                unmaskAll();
            }
            break;

        case 'pattern_cache_sync':
            if (message.payload?.patternArray) {
                updatePatterns(message.payload.patternArray);
                if (isDemoMode) {
                    debouncedScan();
                }
            }
            break;

        case 'key_updated':
            // For incremental updates, reload from storage
            chrome.storage.local.get(['patternCache'], (result) => {
                if (result.patternCache?.patternArray) {
                    updatePatterns(result.patternCache.patternArray);
                    if (isDemoMode) debouncedScan();
                }
            });
            break;
    }
});

// MARK: - Pattern Management

function updatePatterns(newPatterns: PatternEntry[]) {
    patterns = newPatterns;
    compiledPatterns.clear();
    for (const entry of patterns) {
        try {
            compiledPatterns.set(entry.keyId, new RegExp(entry.pattern, 'g'));
        } catch {
            // Invalid regex — skip
        }
    }
}

// MARK: - Scanning & Masking

function scanAndMask() {

    if (!isDemoMode || patterns.length === 0) return;

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                // Skip already-masked elements
                const parent = node.parentElement;
                if (parent?.classList.contains(MASK_CLASS)) return NodeFilter.FILTER_REJECT;
                if (parent?.hasAttribute(MASK_ATTR)) return NodeFilter.FILTER_REJECT;
                // Skip script/style elements
                const tag = parent?.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
                // Skip empty text
                if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        },
    );

    const nodesToMask: { node: Text; entry: PatternEntry; match: RegExpMatchArray }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent ?? '';
        for (const entry of patterns) {
            const regex = compiledPatterns.get(entry.keyId);
            if (!regex) continue;
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                nodesToMask.push({ node: textNode, entry, match: match });
            }
        }
    }

    // Apply masks (process in reverse order to preserve positions)
    for (const { node, entry } of nodesToMask) {
        maskTextNode(node, entry);
    }
}

function maskTextNode(node: Text, entry: PatternEntry) {
    const regex = compiledPatterns.get(entry.keyId);
    if (!regex) return;

    const text = node.textContent ?? '';
    regex.lastIndex = 0;

    if (!regex.test(text)) return;
    regex.lastIndex = 0;

    // Create a document fragment with masked spans
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        // Text before match
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        // Masked span
        const span = document.createElement('span');
        span.className = MASK_CLASS;
        span.setAttribute(MASK_ATTR, entry.keyId);
        span.setAttribute('title', `[Demo-safe] ${entry.serviceName}`);
        span.textContent = entry.maskedPreview;
        fragment.appendChild(span);

        // Record for unmask
        maskRecords.push({
            element: span,
            originalText: match[0],
            keyId: entry.keyId,
        });

        lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    // Replace original text node with fragment
    if (lastIndex > 0) {
        node.parentNode?.replaceChild(fragment, node);
    }
}

// MARK: - Unmasking

function unmaskAll() {
    for (const record of maskRecords) {
        const parent = record.element.parentNode;
        if (!parent) continue;
        const textNode = document.createTextNode(record.originalText);
        parent.replaceChild(textNode, record.element);
        // Normalize adjacent text nodes
        parent.normalize();
    }
    maskRecords = [];
}

// MARK: - Key Detection & Submission

function detectAndSubmitKeys() {
    if (patterns.length === 0) return;

    // Scan visible input/textarea elements for potential keys
    const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input[type="text"], input[type="password"], textarea, [contenteditable="true"], code, pre'
    );

    for (const el of inputs) {
        const text = el.textContent ?? (el as HTMLInputElement).value ?? '';
        if (!text) continue;

        for (const entry of patterns) {
            const regex = compiledPatterns.get(entry.keyId);
            if (!regex) continue;
            regex.lastIndex = 0;
            const match = regex.exec(text);
            if (match) {
                // Submit detected key to Core via background
                chrome.runtime.sendMessage({
                    type: 'submit_detected',
                    payload: {
                        rawValue: match[0],
                        suggestedService: entry.serviceName,
                        pattern: entry.pattern,
                        confidence: 0.8,
                    },
                }).catch(() => {});
            }
        }
    }
}

// MARK: - MutationObserver

function debouncedScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
        scanDebounceTimer = null;
        if (isDemoMode) scanAndMask();
    }, 200);
}

function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
        // Check if any mutations affect text content worth re-scanning
        let shouldRescan = false;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                shouldRescan = true;
                break;
            }
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if added nodes might contain text
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as Element;
                        if (!el.classList?.contains(MASK_CLASS)) {
                            shouldRescan = true;
                            break;
                        }
                    }
                }
            }
            if (shouldRescan) break;
        }

        if (shouldRescan) {
            debouncedScan();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });
}

// MARK: - Bootstrap

startObserver();

// Request current state from background on load
chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
    if (response) {

        isDemoMode = response.isDemoMode ?? false;
        if (isDemoMode) {
            scanAndMask();
        }
    }
});

// Initial scan after page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        detectAndSubmitKeys();
    });
} else {
    detectAndSubmitKeys();
}
