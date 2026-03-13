/**
 * Options page script — displays cache info and provides cache management.
 * Also provides dev IPC config for testing without Native Messaging Host.
 */

function loadCacheInfo() {
    chrome.storage.local.get(['patternCache', 'patternCacheTimestamp'], (result) => {
        const countEl = document.getElementById('cacheCount')!;
        const timestampEl = document.getElementById('cacheTimestamp')!;

        if (result.patternCache?.patternArray) {
            countEl.textContent = String(result.patternCache.patternArray.length);
        } else {
            countEl.textContent = '0 (no cache)';
        }

        if (result.patternCacheTimestamp) {
            const date = new Date(result.patternCacheTimestamp);
            timestampEl.textContent = date.toLocaleString();
        } else {
            timestampEl.textContent = 'Never';
        }
    });
}

function loadDevConfig() {
    chrome.storage.local.get(['devIPCPort', 'devIPCToken'], (result) => {
        const portInput = document.getElementById('devPort') as HTMLInputElement;
        const tokenInput = document.getElementById('devToken') as HTMLInputElement;
        if (result.devIPCPort) portInput.value = String(result.devIPCPort);
        if (result.devIPCToken) tokenInput.value = result.devIPCToken;
    });
}

document.getElementById('clearCache')!.addEventListener('click', () => {
    if (confirm('Clear the pattern cache? Masking will not work until reconnected to Core.')) {
        chrome.storage.local.remove(['patternCache', 'patternCacheTimestamp'], () => {
            loadCacheInfo();
        });
    }
});

document.getElementById('saveDevConfig')!.addEventListener('click', () => {
    const port = parseInt((document.getElementById('devPort') as HTMLInputElement).value, 10);
    const token = (document.getElementById('devToken') as HTMLInputElement).value.trim();

    if (!port || !token) {
        alert('Please enter both port and token.');
        return;
    }

    chrome.storage.local.set({ devIPCPort: port, devIPCToken: token }, () => {
        const statusEl = document.getElementById('devConfigStatus')!;
        statusEl.textContent = 'Saved! Reload extension to reconnect.';
        statusEl.style.color = '#22c55e';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
    });
});

document.getElementById('clearDevConfig')!.addEventListener('click', () => {
    chrome.storage.local.remove(['devIPCPort', 'devIPCToken'], () => {
        (document.getElementById('devPort') as HTMLInputElement).value = '';
        (document.getElementById('devToken') as HTMLInputElement).value = '';
        const statusEl = document.getElementById('devConfigStatus')!;
        statusEl.textContent = 'Cleared.';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
    });
});

loadCacheInfo();
loadDevConfig();
