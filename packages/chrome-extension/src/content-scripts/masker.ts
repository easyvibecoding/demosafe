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
            // Persist for pre-hide.ts on next page load
            chrome.storage.local.set({ demosafeDemoMode: isDemoMode });
            if (isDemoMode) {
                enablePreHide(); // Re-enable manifest CSS protection
                scanAndMask();
                if (isOnSupportedPlatform()) {
                    startPlatformWatcher();
                    startClipboardInterceptor();
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

/** Auto-capture should run when Demo Mode is ON and on a supported platform */
function shouldAutoCapture(): boolean {
    return (isDemoMode && isOnSupportedPlatform()) || isCaptureMode;
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

function submitCapturedKey(match: CaptureMatch) {
    const trimmedValue = match.rawValue.trim();
    // Dedup: skip if already submitted in this capture session
    if (submittedKeys.has(trimmedValue)) return;
    submittedKeys.add(trimmedValue);
    match.rawValue = trimmedValue;

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

    // Immediately mask in DOM without waiting for Core round-trip
    if (isDemoMode) {
        immediatelyMaskValue(trimmedValue, match.serviceName, preview);
    }

    showToast(match.serviceName, preview);
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
    }, 10000);
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
        chrome.storage.local.set({ demosafeDemoMode: isDemoMode });
        if (isDemoMode) {
            enablePreHide();
            scanAndMask();
            if (isOnSupportedPlatform()) {
                startPlatformWatcher();
                startClipboardInterceptor();
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
