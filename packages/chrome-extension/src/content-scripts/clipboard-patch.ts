/**
 * Clipboard writeText interceptor — runs in MAIN world.
 * Patches navigator.clipboard.writeText to dispatch a custom event
 * that the content script (ISOLATED world) can listen to.
 *
 * This is needed because:
 * 1. Some platforms (e.g., Google AI Studio) use writeText directly
 *    instead of document.execCommand('copy')
 * 2. Content scripts can't patch page-world objects
 * 3. Inline script injection is blocked by Trusted Types CSP
 *
 * Injected via manifest.json with "world": "MAIN"
 */

const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);

navigator.clipboard.writeText = function (text: string): Promise<void> {
    // Notify content script via custom event
    window.dispatchEvent(new CustomEvent('demosafe-clipboard-write', {
        detail: { timestamp: Date.now() },
    }));
    return origWriteText(text);
};
