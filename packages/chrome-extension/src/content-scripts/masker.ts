/**
 * Content script — scans and masks API keys on known API console pages.
 * Also handles Active Key Capture mode for detecting new keys.
 *
 * Strategy:
 * 1. CSS overlay approach: wrap matched text in <span> with visual masking
 * 2. Store originals for unmask capability
 * 3. MutationObserver for dynamic content (SPAs, lazy-loaded elements)
 * 4. Debounce observer callbacks to avoid excessive re-scanning
 * 5. Active Capture: three-layer detection (DOM scan + attribute scan + clipboard intercept)
 */

import {
    matchAgainstCapturePatterns,
    getPlatformSelectors,
    getWatchSelectors,
    type CaptureMatch,
} from './capture-patterns';

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
const CAPTURE_TIMEOUT_DEFAULT = 300; // 5 minutes in seconds

// MARK: - Passive Masking State

let patterns: PatternEntry[] = [];
const compiledPatterns: Map<string, RegExp> = new Map();
let isDemoMode = false;
let maskRecords: MaskRecord[] = [];

// MARK: - Active Capture State

let isCaptureMode = false;
let captureTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
const submittedKeys: Set<string> = new Set();

// MARK: - Shared State

let observer: MutationObserver | null = null;
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let captureDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// MARK: - Initialization

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
  .demosafe-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    background: #1a1a2e;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.3s, transform 0.3s;
    pointer-events: none;
  }
  .demosafe-toast.show {
    opacity: 1;
    transform: translateY(0);
  }
  .demosafe-toast .toast-icon { margin-right: 8px; }
  .demosafe-toast .toast-service { color: #f59e0b; font-weight: 600; }
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
    if (!message.action && !message.type) return;

    // Handle action-based messages (from background forwarding Core events)
    const action = message.action ?? message.type;

    switch (action) {
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
            chrome.storage.local.get(['patternCache'], (result) => {
                if (result.patternCache?.patternArray) {
                    updatePatterns(result.patternCache.patternArray);
                    if (isDemoMode) debouncedScan();
                }
            });
            break;

        case 'capture_mode_changed':
            handleCaptureModeChanged(message.payload?.isActive ?? false, message.payload?.timeout ?? CAPTURE_TIMEOUT_DEFAULT);
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

// MARK: - Passive Masking: Scanning

function scanAndMask() {
    if (!isDemoMode || patterns.length === 0) return;

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                if (parent?.classList.contains(MASK_CLASS)) return NodeFilter.FILTER_REJECT;
                if (parent?.hasAttribute(MASK_ATTR)) return NodeFilter.FILTER_REJECT;
                const tag = parent?.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
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
                nodesToMask.push({ node: textNode, entry, match });
            }
        }
    }

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

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const span = document.createElement('span');
        span.className = MASK_CLASS;
        span.setAttribute(MASK_ATTR, entry.keyId);
        span.setAttribute('title', `[Demo-safe] ${entry.serviceName}`);
        span.textContent = entry.maskedPreview;
        fragment.appendChild(span);

        maskRecords.push({
            element: span,
            originalText: match[0],
            keyId: entry.keyId,
        });

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    if (lastIndex > 0) {
        node.parentNode?.replaceChild(fragment, node);
    }
}

// MARK: - Passive Masking: Unmasking

function unmaskAll() {
    for (const record of maskRecords) {
        const parent = record.element.parentNode;
        if (!parent) continue;
        const textNode = document.createTextNode(record.originalText);
        parent.replaceChild(textNode, record.element);
        parent.normalize();
    }
    maskRecords = [];
}

// MARK: - Active Capture: Mode Management

function handleCaptureModeChanged(isActive: boolean, timeout: number) {
    isCaptureMode = isActive;



    if (isActive) {
        submittedKeys.clear();
        startCaptureTimeout(timeout);
        startClipboardInterceptor();
        startPlatformWatcher();
        // Immediately scan current page
        scanForNewKeys();
    } else {
        stopCaptureTimeout();
        stopClipboardInterceptor();
        stopPlatformWatcher();
        submittedKeys.clear();
    }
}

function startCaptureTimeout(seconds: number) {
    stopCaptureTimeout();
    captureTimeoutTimer = setTimeout(() => {
        isCaptureMode = false;
        submittedKeys.clear();
        stopClipboardInterceptor();
        // Notify background that capture timed out
        chrome.runtime.sendMessage({ type: 'capture_timed_out' }).catch(() => {});
    }, seconds * 1000);
}

function stopCaptureTimeout() {
    if (captureTimeoutTimer) {
        clearTimeout(captureTimeoutTimer);
        captureTimeoutTimer = null;
    }
}

// MARK: - Active Capture: Three-Layer Scanning

function scanForNewKeys() {
    if (!isCaptureMode) return;

    const hostname = window.location.hostname;
    const allMatches: CaptureMatch[] = [];



    // Layer 1: TreeWalker — scan all visible text nodes
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                const tag = parent?.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
                if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        },
    );

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent ?? '';
        const matches = matchAgainstCapturePatterns(text, hostname);
        allMatches.push(...matches);
    }

    // Layer 2: Attribute scan — read hidden element values
    // Input fields (password, readonly text, hidden)
    const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="password"], input[type="hidden"]'
    );
    for (const input of inputs) {
        const val = input.value;
        if (val && val.length > 10) {
            const matches = matchAgainstCapturePatterns(val, hostname);
            for (const m of matches) {
                m.captureMethod = 'attribute_scan';
            }
            allMatches.push(...matches);
        }
    }

    // GitHub Web Component: <clipboard-copy value="...">
    const clipboardCopies = document.querySelectorAll('clipboard-copy[value]');
    for (const el of clipboardCopies) {
        const val = el.getAttribute('value');
        if (val && val.length > 10) {
            const matches = matchAgainstCapturePatterns(val, hostname);
            for (const m of matches) {
                m.captureMethod = 'attribute_scan';
            }
            allMatches.push(...matches);
        }
    }

    // Textarea elements
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    for (const ta of textareas) {
        const val = ta.value;
        if (val && val.length > 10) {
            const matches = matchAgainstCapturePatterns(val, hostname);
            for (const m of matches) {
                m.captureMethod = 'attribute_scan';
            }
            allMatches.push(...matches);
        }
    }

    // Layer 4: Platform-specific selectors
    scanPlatformSpecific(hostname, allMatches);

    // Submit unique matches
    for (const match of allMatches) {
        submitCapturedKey(match);
    }
}

// MARK: - Active Capture: Platform-Specific Scanning

function scanPlatformSpecific(hostname: string, allMatches: CaptureMatch[]) {
    const platformEntries = getPlatformSelectors(hostname);
    if (platformEntries.length === 0) return;

    for (const { pattern, selector: ps } of platformEntries) {
        for (const cssSelector of ps.selectors) {
            let elements: NodeListOf<Element>;
            try {
                elements = document.querySelectorAll(cssSelector);
            } catch {
                continue; // Invalid selector — skip
            }

            for (const el of elements) {
                const textsToCheck: string[] = [];

                // Read specified attributes (e.g., value for input, clipboard-copy)
                if (ps.attributes) {
                    for (const attr of ps.attributes) {
                        const val = (el as HTMLInputElement).value ?? el.getAttribute(attr);
                        if (val) textsToCheck.push(val);
                    }
                }

                // Always also check textContent
                const tc = el.textContent?.trim();
                if (tc) textsToCheck.push(tc);

                for (const text of textsToCheck) {
                    if (!text || text.length < 10) continue;
                    // Skip truncated (e.g., "sk-...xxxx", "hf_...DGlI")
                    if (text.includes('...') && text.length < pattern.minLength) continue;

                    const matches = matchAgainstCapturePatterns(text, hostname);
                    for (const m of matches) {
                        if (m.patternId === pattern.id) {
                            m.captureMethod = 'platform_selector';
                            // Boost confidence for platform-specific match
                            m.confidence = Math.min(1.0, m.confidence + 0.03);
                            allMatches.push(m);
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Active Capture: Platform Modal Watcher

let platformWatcher: MutationObserver | null = null;

function startPlatformWatcher() {
    if (platformWatcher) return;

    const hostname = window.location.hostname;
    const watchSelectors = getWatchSelectors(hostname);
    if (watchSelectors.length === 0) return;

    platformWatcher = new MutationObserver((mutations) => {
        if (!isCaptureMode) return;

        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;

            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const el = node as Element;

                // Check if added element matches any watch selector
                const isRelevant = watchSelectors.some(sel => {
                    try {
                        return el.matches(sel) || el.querySelector(sel);
                    } catch {
                        return false;
                    }
                });

                if (isRelevant) {
                    // Modal/dialog appeared — scan immediately for keys
                    setTimeout(() => {
                        if (isCaptureMode) scanForNewKeys();
                    }, 200); // Small delay for DOM to settle
                    return;
                }
            }

            // Also check for attribute changes on watch selectors (e.g., data-state="open")
            if (mutation.type === 'childList') {
                for (const sel of watchSelectors) {
                    try {
                        const openElements = document.querySelectorAll(sel);
                        for (const oel of openElements) {
                            if (oel.getAttribute('data-state') === 'open' ||
                                (oel as HTMLElement).offsetParent !== null) {
                                setTimeout(() => {
                                    if (isCaptureMode) scanForNewKeys();
                                }, 200);
                                return;
                            }
                        }
                    } catch {
                        // Invalid selector
                    }
                }
            }
        }
    });

    platformWatcher.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'class', 'style'],
    });
}

function stopPlatformWatcher() {
    if (platformWatcher) {
        platformWatcher.disconnect();
        platformWatcher = null;
    }
}

// MARK: - Active Capture: Clipboard Interceptor

let clipboardInterceptorActive = false;

function startClipboardInterceptor() {
    if (clipboardInterceptorActive) return;
    clipboardInterceptorActive = true;
    document.addEventListener('copy', handleCopyEvent, true);
}

function stopClipboardInterceptor() {
    if (!clipboardInterceptorActive) return;
    clipboardInterceptorActive = false;
    document.removeEventListener('copy', handleCopyEvent, true);
}

function handleCopyEvent() {
    if (!isCaptureMode) return;

    // Read clipboard after a short delay (copy event fires before clipboard is populated)
    setTimeout(() => {
        navigator.clipboard.readText().then((text) => {
            if (!text || text.length < 10) return;
            const hostname = window.location.hostname;
            const matches = matchAgainstCapturePatterns(text, hostname);
            for (const match of matches) {
                match.captureMethod = 'clipboard_intercept';
                submitCapturedKey(match);
            }
        }).catch(() => {
            // Clipboard read permission denied — ignore
        });
    }, 100);
}

// MARK: - Active Capture: Submission

function submitCapturedKey(match: CaptureMatch) {
    // Dedup: skip if already submitted in this capture session
    if (submittedKeys.has(match.rawValue)) return;
    submittedKeys.add(match.rawValue);

    // Mask preview: show prefix + ****
    const preview = match.rawValue.length > 12
        ? match.rawValue.slice(0, 8) + '****...'
        : '****...****';

    chrome.runtime.sendMessage({
        type: 'submit_captured_key',
        payload: {
            rawValue: match.rawValue,
            suggestedService: match.serviceName,
            sourceURL: window.location.href,
            confidence: match.confidence,
            captureMethod: match.captureMethod,
        },
    }).catch(() => {});

    showToast(match.serviceName, preview);
}

// MARK: - Toast Notification

function showToast(serviceName: string, preview: string) {
    const existing = document.querySelector('.demosafe-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'demosafe-toast';
    toast.innerHTML =
        `<span class="toast-icon">🔑</span>` +
        `<span class="toast-service">${serviceName}</span> ` +
        `key captured: <code>${preview}</code>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// MARK: - MutationObserver

function debouncedScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
        scanDebounceTimer = null;
        if (isDemoMode) scanAndMask();
    }, 200);
}

function debouncedCaptureScan() {
    if (captureDebounceTimer) clearTimeout(captureDebounceTimer);
    captureDebounceTimer = setTimeout(() => {
        captureDebounceTimer = null;
        if (isCaptureMode) scanForNewKeys();
    }, 300);
}

function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
        let shouldRescan = false;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                shouldRescan = true;
                break;
            }
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
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
            if (isCaptureMode) {
                debouncedCaptureScan();
            }
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
        // Restore capture mode if active
        if (response.isCaptureMode) {
            const remaining = response.captureTimeoutEnd
                ? Math.max(0, Math.floor((response.captureTimeoutEnd - Date.now()) / 1000))
                : CAPTURE_TIMEOUT_DEFAULT;
            if (remaining > 0) {
                handleCaptureModeChanged(true, remaining);
            }
        }
    }
});
