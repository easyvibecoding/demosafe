/**
 * Pre-hide content script — runs at document_start to hide key elements
 * BEFORE they render. Prevents flash of plaintext keys.
 *
 * All pattern definitions come from capture-patterns.ts (Single Source of Truth).
 *
 * Two layers of protection:
 * 1. CSS rules from capture-patterns.ts preHideCSS field
 * 2. Instant MutationObserver that hides dialog elements containing key patterns
 *
 * masker.ts restores visibility after masking, or removes CSS if Demo Mode OFF.
 */

import { KEY_PREFIXES, getPreHideCSS } from './capture-patterns';

const PRE_HIDE_ID = 'demosafe-pre-hide';

// === Layer 1: CSS pre-hide (from capture-patterns.ts) ===

const hostname = window.location.hostname;
const css = getPreHideCSS(hostname);
if (css) {
    const style = document.createElement('style');
    style.id = PRE_HIDE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    // Safety: remove after 5s if masker.ts doesn't load
    setTimeout(() => {
        const el = document.getElementById(PRE_HIDE_ID);
        if (el) el.remove();
    }, 5000);
}

// === Layer 2: Instant MutationObserver ===
// Catches dynamically created dialogs BEFORE browser paints.

function containsFullKey(text: string): boolean {
    if (text.length < 20) return false;
    if (text.includes('...') && text.length < 50) return false;
    if (text.includes('****')) return false;
    for (const prefix of KEY_PREFIXES) {
        const idx = text.indexOf(prefix);
        if (idx >= 0) {
            const afterPrefix = text.slice(idx + prefix.length);
            if (afterPrefix.length >= 15 && !afterPrefix.startsWith('...')) return true;
        }
    }
    return false;
}

function hideElementIfKey(el: Element) {
    const text = el.textContent || '';
    if (containsFullKey(text)) {
        (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
        el.setAttribute('data-demosafe-prehidden', 'true');
    }
    if (el.tagName === 'INPUT') {
        const val = (el as HTMLInputElement).value;
        if (val && containsFullKey(val)) {
            (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
            el.setAttribute('data-demosafe-prehidden', 'true');
        }
    }
}

const instantObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as Element;

            // Only act on dialogs/modals — don't hide list page elements
            const isDialog = el.getAttribute('role') === 'dialog' ||
                el.closest('[role="dialog"]') !== null ||
                el.querySelector('[role="dialog"]') !== null;

            if (isDialog) {
                const targets = el.querySelectorAll('p, code, span, input, pre, .font-mono, .bg-accent-900');
                for (const target of targets) {
                    hideElementIfKey(target);
                }
                hideElementIfKey(el);
            } else {
                // Non-dialog: only hide specific key display elements
                if (el.tagName === 'CLIPBOARD-COPY' || el.id === 'new-oauth-token' ||
                    el.classList.contains('flash')) {
                    hideElementIfKey(el);
                    el.querySelectorAll('code').forEach(c => hideElementIfKey(c));
                }
            }
        }
    }
});

if (document.body) {
    instantObserver.observe(document.body, { childList: true, subtree: true });
} else {
    const bodyObserver = new MutationObserver(() => {
        if (document.body) {
            bodyObserver.disconnect();
            instantObserver.observe(document.body, { childList: true, subtree: true });
        }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
}

(window as unknown as Record<string, unknown>).__demosafe_instant_observer = instantObserver;
