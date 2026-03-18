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
    getPreHideCSS,
    getPatternRegexSource,
    DOMAIN_SERVICE_MAP,
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
const CONFIDENCE_HIGH = 0.7;
const CONFIDENCE_MIN = 0.35;

// MARK: - Passive Masking State

let patterns: PatternEntry[] = [];
const compiledPatterns: Map<string, RegExp> = new Map();
let isDemoMode = false;
let maskRecords: MaskRecord[] = [];

// MARK: - Active Capture State

let isCaptureMode = false;
let isUniversalMasking = false;
let isUniversalDetection = false;
let captureTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
const submittedKeys: Set<string> = new Set();
const rejectedKeys: Set<string> = new Set();

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
  .demosafe-confirm-dialog {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 360px; background: #1a1a2e; color: #fff;
    border: 1px solid #f59e0b; border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    opacity: 0; transform: translateY(-12px);
    transition: opacity 0.3s, transform 0.3s; pointer-events: auto;
  }
  .demosafe-confirm-dialog .dsc-header { padding: 12px 16px 8px; font-weight: 600; font-size: 14px; color: #f59e0b; }
  .demosafe-confirm-dialog .dsc-body { padding: 0 16px 12px; }
  .demosafe-confirm-dialog .dsc-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .demosafe-confirm-dialog .dsc-label { color: #999; font-size: 12px; }
  .demosafe-confirm-dialog .dsc-key { font-family: monospace; background: #2a2a4e; padding: 2px 6px; border-radius: 4px; }
  .demosafe-confirm-dialog .dsc-confidence { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; background: rgba(245,158,11,0.2); color: #f59e0b; }
  .demosafe-confirm-dialog .dsc-input { width: 100%; padding: 6px 8px; border: 1px solid #444; border-radius: 4px; background: #2a2a4e; color: #fff; font-size: 13px; outline: none; }
  .demosafe-confirm-dialog .dsc-input:focus { border-color: #f59e0b; }
  .demosafe-confirm-dialog .dsc-source { color: #888; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .demosafe-confirm-dialog .dsc-actions { display: flex; gap: 8px; padding: 0 16px 12px; justify-content: flex-end; }
  .demosafe-confirm-dialog .dsc-btn { padding: 6px 16px; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .demosafe-confirm-dialog .dsc-btn-confirm { background: #22c55e; color: #fff; }
  .demosafe-confirm-dialog .dsc-btn-confirm:hover { background: #16a34a; }
  .demosafe-confirm-dialog .dsc-btn-reject { background: #374151; color: #d1d5db; }
  .demosafe-confirm-dialog .dsc-btn-reject:hover { background: #4b5563; }
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
            // Persist for pre-hide.ts on next page load
            chrome.storage.local.set({ demosafeDemoMode: isDemoMode });
            if (isDemoMode) {
                if (isOnSupportedPlatform() || isUniversalMasking) {
                    enablePreHide();
                    scanAndMask();
                }
                if (isOnSupportedPlatform()) {
                    startPlatformWatcher();
                    startClipboardInterceptor();
                    startInputPolling();
                    scanForNewKeys();
                } else if (shouldAutoCapture()) {
                    startInputPolling();
                    scanForNewKeys();
                }
            } else {
                unmaskAll();
                removePreHide(); // Override manifest CSS to show keys normally
                if (!isCaptureMode) {
                    stopPlatformWatcher();
                    stopClipboardInterceptor();
                    stopInputPolling();
                }
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

        case 'key_confirmed':
            showToast(message.payload?.serviceName ?? 'Unknown', 'key stored');
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

    // If auto-capture is active, submit matched values BEFORE masking replaces them
    if (shouldAutoCapture()) {
        for (const { match } of nodesToMask) {
            const rawValue = match[0].trim();
            if (rawValue.length >= 20 && !rawValue.includes('****') && !submittedKeys.has(rawValue)) {
                const hostname = window.location.hostname;
                const captureMatches = matchAgainstCapturePatterns(rawValue, hostname);
                for (const cm of captureMatches) {
                    submitCapturedKey(cm);
                }
            }
        }
    }

    for (const { node, entry } of nodesToMask) {
        maskTextNode(node, entry);
    }

    // Restore pre-hidden elements after masking is done.
    // Skip elements inside dialogs — manifest CSS keeps those hidden safely.
    if (nodesToMask.length > 0) {
        document.querySelectorAll('[data-demosafe-prehidden]').forEach(el => {
            if (!el.closest('[data-state="open"], [role="dialog"], dialog, .gl-alert-success')) {
                (el as HTMLElement).style.setProperty('visibility', 'visible', 'important');
            }
            el.removeAttribute('data-demosafe-prehidden');
        });
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

// MARK: - Pre-hide Removal

/** Remove pre-hide CSS, stop instant observer, and override manifest CSS */
function removePreHide() {
    const el = document.getElementById('demosafe-pre-hide');
    if (el) el.remove();

    // Stop the instant observer from pre-hide.ts
    const obs = (window as unknown as Record<string, unknown>).__demosafe_instant_observer as MutationObserver | undefined;
    if (obs) {
        obs.disconnect();
        delete (window as unknown as Record<string, unknown>).__demosafe_instant_observer;
    }

    // Restore visibility on elements hidden by instant observer
    document.querySelectorAll('[data-demosafe-prehidden]').forEach(el => {
        (el as HTMLElement).style.removeProperty('visibility');
        el.removeAttribute('data-demosafe-prehidden');
    });

    // Override manifest-injected CSS for current platform.
    // Manifest CSS can't be removed by JS, so inject higher-priority visible rules.
    if (!document.getElementById('demosafe-prehide-override')) {
        const hostname = window.location.hostname;
        const css = getPreHideCSS(hostname);
        if (css) {
            const override = document.createElement('style');
            override.id = 'demosafe-prehide-override';
            // Replace "visibility: hidden" with "visibility: visible" in the same selectors
            override.textContent = css.replace(/visibility:\s*hidden\s*!important/g, 'visibility: visible !important');
            document.head.appendChild(override);
        }
    }
}

/** Remove the manifest CSS override (re-enable pre-hide when Demo Mode turns ON) */
function enablePreHide() {
    const override = document.getElementById('demosafe-prehide-override');
    if (override) override.remove();
}

// MARK: - Auto Capture in Demo Mode

/** Check if current page is a supported platform for auto-capture */
function isOnSupportedPlatform(): boolean {
    const hostname = window.location.hostname;
    if (hostname in DOMAIN_SERVICE_MAP) return true;
    // Subdomain match (e.g., us-east-1.console.aws.amazon.com)
    for (const domain of Object.keys(DOMAIN_SERVICE_MAP)) {
        if (hostname.endsWith('.' + domain)) return true;
    }
    return false;
}

/** Auto-capture should run when Demo Mode is ON and on a supported platform, or universal detection is enabled */
function shouldAutoCapture(): boolean {
    if (isCaptureMode) return true;
    if (isDemoMode && isOnSupportedPlatform()) return true;
    if (isDemoMode && isUniversalDetection) return true;
    return false;
}

// MARK: - Active Capture: Mode Management

function handleCaptureModeChanged(isActive: boolean, timeout: number) {
    isCaptureMode = isActive;



    if (isActive) {
        submittedKeys.clear();
        startCaptureTimeout(timeout);
        startClipboardInterceptor();
        startPlatformWatcher();
        startInputPolling();
        scanForNewKeys();
    } else {
        stopCaptureTimeout();
        stopClipboardInterceptor();
        stopPlatformWatcher();
        stopInputPolling();
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
    if (!shouldAutoCapture()) return;



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
    // Input fields (password, readonly, hidden, and typeless inputs)
    const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="password"], input[type="hidden"], input[readonly], input:not([type])'
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

    // Deduplicate within this scan cycle before submitting
    const seen = new Set<string>();
    for (const match of allMatches) {
        const key = match.rawValue.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        match.rawValue = key;
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
        if (!shouldAutoCapture()) return;

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
                        if (shouldAutoCapture()) scanForNewKeys();
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
                                    if (shouldAutoCapture()) scanForNewKeys();
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

// MARK: - Active Capture: Input Value Polling

let inputPollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Poll input values periodically. MutationObserver cannot detect
 * input.value changes set via JavaScript (SPA frameworks).
 */
function startInputPolling() {
    if (inputPollTimer) return;
    inputPollTimer = setInterval(() => {
        if (!shouldAutoCapture()) {
            stopInputPolling();
            return;
        }
        scanForNewKeys();
    }, 500); // Check every 500ms
}

function stopInputPolling() {
    if (inputPollTimer) {
        clearInterval(inputPollTimer);
        inputPollTimer = null;
    }
}

// MARK: - Active Capture: Clipboard Interceptor

let clipboardInterceptorActive = false;

function startClipboardInterceptor() {
    if (clipboardInterceptorActive) return;
    clipboardInterceptorActive = true;
    document.addEventListener('copy', handleCopyEvent, true);
    patchClipboardWriteText();
}

function stopClipboardInterceptor() {
    if (!clipboardInterceptorActive) return;
    clipboardInterceptorActive = false;
    document.removeEventListener('copy', handleCopyEvent, true);
    restoreClipboardWriteText();
}

function handleCopyEvent() {
    if (!shouldAutoCapture()) return;

    setTimeout(() => {
        navigator.clipboard.readText().then((text) => {
            if (!text || text.length < 10) return;
            handleClipboardText(text);
        }).catch(() => {});
    }, 100);
}

/**
 * Process clipboard text for key capture.
 * Handles both pattern-matched keys and special cases like AWS Secret Access Key.
 */
function handleClipboardText(text: string) {
    const hostname = window.location.hostname;
    const matches = matchAgainstCapturePatterns(text, hostname);
    for (const match of matches) {
        match.captureMethod = 'clipboard_intercept';
        submitCapturedKey(match);
    }

    // AWS Secret Access Key: 40-char base64 string without AKIA/ASIA prefix.
    // Only on AWS console pages, only via clipboard (no DOM scan).
    if (matches.length === 0 && isAwsConsolePage(hostname)) {
        const awsSecretPattern = /^[A-Za-z0-9/+=]{40}$/;
        if (awsSecretPattern.test(text.trim()) &&
            !text.startsWith('AKIA') && !text.startsWith('ASIA')) {
            submitCapturedKey({
                rawValue: text.trim(),
                serviceName: 'AWS',
                patternId: 'aws-secret-key',
                confidence: 0.85,
                captureMethod: 'clipboard_intercept',
            });
        }
    }
}

function isAwsConsolePage(hostname: string): boolean {
    return hostname === 'console.aws.amazon.com' ||
        hostname.endsWith('.console.aws.amazon.com');
}

/**
 * Auto-click the Secret Access Key copy button on AWS key creation result page.
 * The container has 2 copy buttons: [0] = Access Key ID, [1] = Secret Access Key.
 * Clicking triggers clipboard.writeText → clipboard-patch.ts → handleClipboardText.
 */
function autoClickAwsSecretKeyCopy() {
    setTimeout(() => {
        const container = document.querySelector('.create-root-access-key-container');
        if (!container) return;
        const copyButtons = container.querySelectorAll<HTMLButtonElement>('button[data-testid="copy-button"]');
        if (copyButtons.length >= 2) {
            copyButtons[1].click();
        }
    }, 500);
}

/**
 * AI Studio: auto-click the copy button for the most recently created key.
 * After key creation, AI Studio closes the dialog and returns to the list.
 * The list only shows truncated keys — full key is only available via the copy button
 * which uses navigator.clipboard.writeText (intercepted by clipboard-patch.ts).
 */
let aiStudioKeyCount = -1;

function isAiStudioKeyPage(): boolean {
    return window.location.hostname === 'aistudio.google.com' &&
        window.location.pathname.startsWith('/api-keys');
}

function initAiStudioWatcher() {
    if (!isAiStudioKeyPage()) return;
    // Snapshot baseline after page fully settles
    setTimeout(() => {
        const btns = document.querySelectorAll<HTMLButtonElement>('button.xap-copy-to-clipboard');
        aiStudioKeyCount = btns.length;
    }, 5000);
}

function watchAiStudioKeyCreation() {
    if (!isAiStudioKeyPage()) return;
    if (!shouldAutoCapture()) return;
    if (aiStudioKeyCount === -1) return; // Not initialized yet

    const currentCount = document.querySelectorAll<HTMLButtonElement>('button.xap-copy-to-clipboard').length;

    // Ignore transient count=0 during Angular re-render (delete/navigation)
    if (currentCount === 0) return;

    const prevCount = aiStudioKeyCount;
    aiStudioKeyCount = currentCount;

    if (currentCount > prevCount) {
        setTimeout(() => {
            const btn = document.querySelector<HTMLButtonElement>('button.xap-copy-to-clipboard');
            if (btn) btn.click();
        }, 500);
    }
}

// Listen for clipboard writeText events from clipboard-patch.ts (MAIN world)
let clipboardListenerActive = false;

function patchClipboardWriteText() {
    if (clipboardListenerActive) return;
    clipboardListenerActive = true;

    window.addEventListener('demosafe-clipboard-write', () => {
        setTimeout(() => {
            navigator.clipboard.readText().then((text) => {
                if (!text || text.length < 10 || !shouldAutoCapture()) return;
                handleClipboardText(text);
            }).catch(() => {});
        }, 150);
    });
}

function restoreClipboardWriteText() {
    // Listener stays but shouldAutoCapture() gates execution
}

// MARK: - Active Capture: Submission

function generateMaskedPreview(rawValue: string): string {
    return rawValue.length > 12 ? rawValue.slice(0, 8) + '****...' : '****...****';
}

function submitCapturedKey(match: CaptureMatch) {
    const trimmedValue = match.rawValue.trim();
    if (submittedKeys.has(trimmedValue)) return;
    if (rejectedKeys.has(trimmedValue)) return;
    submittedKeys.add(trimmedValue);
    match.rawValue = trimmedValue;

    const preview = generateMaskedPreview(trimmedValue);

    if (match.confidence >= CONFIDENCE_HIGH) {
        // High confidence — submit + mask + toast (original behavior)
        chrome.runtime.sendMessage({
            type: 'submit_captured_key',
            payload: {
                rawValue: match.rawValue,
                suggestedService: match.serviceName,
                sourceURL: window.location.href,
                confidence: match.confidence,
                captureMethod: match.captureMethod,
                pattern: getPatternRegexSource(match.patternId),
            },
        }).catch(() => {});
        if (isDemoMode) {
            immediatelyMaskValue(trimmedValue, match.serviceName, preview);
        }
        showToast(match.serviceName, preview);

        // AWS dual-key: after Access Key ID is captured, auto-click Secret Key copy button
        if (match.patternId === 'aws-access-key') {
            autoClickAwsSecretKeyCopy();
        }

    } else if (match.confidence >= CONFIDENCE_MIN) {
        // Medium confidence — mask first (prevent leak), then show confirmation
        if (isDemoMode) {
            immediatelyMaskValue(trimmedValue, match.serviceName, preview);
        }
        showConfirmationDialog(match, preview);
    }
    // Below CONFIDENCE_MIN — silently ignore
}

// MARK: - Active Capture: Confirmation Dialog

const pendingConfirmations: { match: CaptureMatch; preview: string }[] = [];
let confirmDialogActive = false;

function showConfirmationDialog(match: CaptureMatch, preview: string) {
    if (confirmDialogActive) {
        pendingConfirmations.push({ match, preview });
        return;
    }
    confirmDialogActive = true;
    document.querySelector('.demosafe-confirm-dialog')?.remove();

    const dialog = document.createElement('div');
    dialog.className = 'demosafe-confirm-dialog';
    dialog.innerHTML = `
        <div class="dsc-header">⚠ Possible API Key Detected</div>
        <div class="dsc-body">
            <div class="dsc-row"><span class="dsc-label">Key</span><span class="dsc-key">${preview}</span></div>
            <div class="dsc-row"><span class="dsc-label">Confidence</span><span class="dsc-confidence">${Math.round(match.confidence * 100)}%</span></div>
            <div class="dsc-row"><span class="dsc-label">Service</span><span style="flex:1;margin-left:8px"><input class="dsc-input" type="text" value="${match.serviceName}" /></span></div>
            <div class="dsc-row"><span class="dsc-label">Source</span><span class="dsc-source">${window.location.hostname}</span></div>
        </div>
        <div class="dsc-actions">
            <button class="dsc-btn dsc-btn-reject">Reject</button>
            <button class="dsc-btn dsc-btn-confirm">Confirm</button>
        </div>`;

    const serviceInput = dialog.querySelector<HTMLInputElement>('.dsc-input')!;

    const closeDialog = (reject: boolean) => {
        dialog.style.opacity = '0';
        dialog.style.transform = 'translateY(-12px)';
        document.removeEventListener('keydown', escHandler);
        if (reject) {
            rejectedKeys.add(match.rawValue);
            removeMaskForValue(match.rawValue);
        }
        setTimeout(() => {
            dialog.remove();
            confirmDialogActive = false;
            const next = pendingConfirmations.shift();
            if (next) showConfirmationDialog(next.match, next.preview);
        }, 300);
    };

    dialog.querySelector('.dsc-btn-confirm')!.addEventListener('click', () => {
        chrome.runtime.sendMessage({
            type: 'confirm_captured_key',
            payload: {
                rawValue: match.rawValue,
                suggestedService: serviceInput.value.trim() || match.serviceName,
                sourceURL: window.location.href,
                captureMethod: match.captureMethod,
                pattern: getPatternRegexSource(match.patternId),
            },
        }).catch(() => {});
        closeDialog(false);
    });

    dialog.querySelector('.dsc-btn-reject')!.addEventListener('click', () => closeDialog(true));

    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDialog(true); };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => { if (dialog.parentNode) closeDialog(true); }, 30000);

    document.body.appendChild(dialog);
    requestAnimationFrame(() => { dialog.style.opacity = '1'; dialog.style.transform = 'translateY(0)'; });
}

// MARK: - Active Capture: Remove Mask for Rejected Key

function removeMaskForValue(rawValue: string) {
    const toRemove: MaskRecord[] = [];
    const remaining: MaskRecord[] = [];
    for (const record of maskRecords) {
        if (record.originalText === rawValue) toRemove.push(record);
        else remaining.push(record);
    }
    for (const record of toRemove) {
        const parent = record.element.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(record.originalText), record.element);
        parent.normalize();
    }
    maskRecords = remaining;
    document.querySelectorAll<HTMLInputElement>('input[data-demosafe-original], textarea[data-demosafe-original]').forEach(el => {
        if (el.getAttribute('data-demosafe-original') === rawValue) {
            el.value = rawValue;
            el.removeAttribute('data-demosafe-original');
        }
    });
}

/**
 * Immediately mask a captured key value in the DOM.
 * Does not wait for Core's pattern_cache_sync — provides instant visual protection.
 */
function immediatelyMaskValue(rawValue: string, serviceName: string, maskedPreview: string) {
    const escapedValue = rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedValue, 'g');

    // Scan text nodes
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
                if (!node.textContent?.includes(rawValue)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        },
    );

    const nodesToMask: Text[] = [];
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        nodesToMask.push(textNode);
    }

    for (const node of nodesToMask) {
        const text = node.textContent ?? '';
        regex.lastIndex = 0;
        if (!regex.test(text)) continue;
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
            span.setAttribute(MASK_ATTR, 'captured');
            span.setAttribute('title', `[Demo-safe] ${serviceName}`);
            span.textContent = maskedPreview;
            fragment.appendChild(span);

            maskRecords.push({
                element: span,
                originalText: match[0],
                keyId: 'captured',
            });

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        if (lastIndex > 0) {
            node.parentNode?.replaceChild(fragment, node);
            // Restore visibility on elements hidden by pre-hide CSS or instant observer.
            // Skip elements inside dialogs — manifest CSS should keep those hidden
            // since SPA frameworks can overwrite our DOM changes.
            let ancestor = node.parentNode as HTMLElement | null;
            const isInDialog = ancestor?.closest('[data-state="open"], [role="dialog"], dialog, .gl-alert-success');
            if (!isInDialog) {
                for (let i = 0; i < 6 && ancestor; i++) {
                    if (ancestor.hasAttribute('data-demosafe-prehidden') ||
                        window.getComputedStyle(ancestor).visibility === 'hidden') {
                        ancestor.style.setProperty('visibility', 'visible', 'important');
                        ancestor.removeAttribute('data-demosafe-prehidden');
                    }
                    ancestor = ancestor.parentElement;
                }
            }
        }
    }

    // Also mask in input/textarea values (replace with masked preview)
    document.querySelectorAll<HTMLInputElement>('input, textarea').forEach(el => {
        if (el.value?.includes(rawValue)) {
            el.setAttribute('data-demosafe-original', rawValue);
            // Check if input is inside a pre-hide CSS scope (dialog/modal).
            // SPA frameworks (React) control input.value — direct replacement gets overwritten.
            // Keep these inputs hidden by manifest CSS instead of making them visible.
            const inDialog = el.closest('[data-state="open"], [role="dialog"], dialog, .gl-alert-success');
            if (inDialog) {
                // Don't set visibility:visible — manifest CSS keeps it hidden safely.
                // Value replacement would be overwritten by React anyway.
                return;
            }
            el.value = el.value.replace(rawValue, maskedPreview);
            el.style.setProperty('visibility', 'visible', 'important');
            el.style.setProperty('color', 'inherit', 'important');
        }
    });

    // Restore pre-hidden elements now that key is masked.
    // Skip elements inside dialogs — manifest CSS keeps those hidden safely.
    document.querySelectorAll('[data-demosafe-prehidden]').forEach(el => {
        if (!el.closest('[data-state="open"], [role="dialog"], dialog, .gl-alert-success')) {
            (el as HTMLElement).style.setProperty('visibility', 'visible', 'important');
        }
        el.removeAttribute('data-demosafe-prehidden');
    });
}

// MARK: - Toast Notification

function showToast(serviceName: string, preview: string) {
    // Stack toasts: calculate offset based on existing toasts
    const existingToasts = document.querySelectorAll('.demosafe-toast');
    let topOffset = 16;
    existingToasts.forEach(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const bottom = rect.top + rect.height + 8; // 8px gap between toasts
        if (bottom > topOffset) topOffset = bottom;
    });

    const toast = document.createElement('div');
    toast.className = 'demosafe-toast';
    toast.style.cssText = `
        position: fixed !important;
        top: ${topOffset}px !important;
        right: 16px !important;
        z-index: 2147483647 !important;
        background: #1a1a2e !important;
        color: #fff !important;
        padding: 10px 16px !important;
        border-radius: 8px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        font-size: 13px !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
    `;
    toast.innerHTML =
        `<span style="margin-right:8px">🔑</span>` +
        `<span style="color:#f59e0b;font-weight:600">${serviceName}</span> ` +
        `key captured: <code>${preview}</code>`;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        setTimeout(() => toast.remove(), 300);
    }, 25000);
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
        if (shouldAutoCapture()) scanForNewKeys();
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
            if (shouldAutoCapture()) {
                debouncedCaptureScan();
                watchAiStudioKeyCreation();
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
initAiStudioWatcher();

// Request current state from background on load
chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
    if (response) {
        isDemoMode = response.isDemoMode ?? false;
        isUniversalMasking = response.isUniversalMasking ?? false;
        isUniversalDetection = response.isUniversalDetection ?? false;
        chrome.storage.local.set({ demosafeDemoMode: isDemoMode });
        if (isDemoMode) {
            if (isOnSupportedPlatform() || isUniversalMasking) {
                enablePreHide();
                scanAndMask();
            }
            if (isOnSupportedPlatform()) {
                startPlatformWatcher();
                startClipboardInterceptor();
                startInputPolling();
                scanForNewKeys();
            } else if (shouldAutoCapture()) {
                startInputPolling();
                scanForNewKeys();
            }
        } else {
            removePreHide();
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
