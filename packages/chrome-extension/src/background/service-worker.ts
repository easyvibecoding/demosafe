/**
 * Background Service Worker — maintains WebSocket connection to DemoSafe Core.
 * Uses Native Messaging Host to read ipc.json for connection info.
 *
 * Responsibilities:
 * - WebSocket lifecycle (connect, handshake, reconnect with exponential backoff)
 * - Forward Core events to content scripts
 * - Persist pattern cache to chrome.storage.local
 * - Respond to popup/options requests
 */

const NATIVE_HOST_ID = 'com.demosafe.nmh';
const MAX_RECONNECT_DELAY = 30000;

interface IPCConfig {
    port: number;
    token: string;
}

interface IPCMessage {
    id: string;
    type: 'request' | 'response' | 'event';
    action: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

interface DemoSafeState {
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const state: DemoSafeState = {
    isConnected: false,
    isDemoMode: false,
    activeContextName: null,
    patternCount: 0,
};

// MARK: - Native Messaging Host

async function getIPCConfig(): Promise<IPCConfig | null> {
    // Try Native Messaging Host first
    const nativeConfig = await getNativeConfig();
    if (nativeConfig) return nativeConfig;

    // Dev fallback: try config stored in chrome.storage.local
    const stored = await chrome.storage.local.get(['devIPCPort', 'devIPCToken']);
    if (stored.devIPCPort && stored.devIPCToken) {
        return { port: stored.devIPCPort, token: stored.devIPCToken };
    }

    return null;
}

async function getNativeConfig(): Promise<IPCConfig | null> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_ID, { action: 'get_config' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    resolve(null);
                } else {
                    resolve(response as IPCConfig);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

// MARK: - WebSocket Connection

async function connect() {
    // Close existing connection if any
    if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
    }

    const config = await getIPCConfig();
    if (!config) {
        state.isConnected = false;
        scheduleReconnect();
        return;
    }

    try {
        ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
    } catch {
        state.isConnected = false;
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        reconnectDelay = 1000;
        sendHandshake(config.token);
    };

    ws.onmessage = (event) => {
        try {
            const message: IPCMessage = JSON.parse(event.data as string);
            handleMessage(message);
        } catch {
            // Ignore malformed messages
        }
    };

    ws.onclose = () => {
        state.isConnected = false;
        broadcastStateToPopup();
        scheduleReconnect();
    };

    ws.onerror = () => {
        ws?.close();
    };
}

function sendHandshake(token: string) {
    sendToCore({
        id: crypto.randomUUID(),
        type: 'request',
        action: 'handshake',
        payload: { clientType: 'chrome', token, version: '0.1.0' },
        timestamp: new Date().toISOString(),
    });
}

function sendToCore(message: IPCMessage) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
}

function sendRequestToCore(action: string, payload: Record<string, unknown>) {
    sendToCore({
        id: crypto.randomUUID(),
        type: 'request',
        action,
        payload,
        timestamp: new Date().toISOString(),
    });
}

// MARK: - Message Handling

function handleMessage(message: IPCMessage) {
    // Handshake response
    if (message.type === 'response' && message.action === 'handshake') {
        if (message.payload.status === 'success') {
            state.isConnected = true;
            state.isDemoMode = message.payload.isDemoMode as boolean;
            broadcastStateToPopup();
        }
        return;
    }

    // Events from Core
    if (message.type === 'event') {
        switch (message.action) {
            case 'state_changed':
                handleStateChanged(message.payload);
                break;
            case 'pattern_cache_sync':
                handlePatternCacheSync(message.payload);
                break;
            case 'key_updated':
                handleKeyUpdated(message.payload);
                break;
            case 'clipboard_cleared':
                // Forward to content scripts
                forwardToContentScripts(message);
                break;
        }
    }
}

function handleStateChanged(payload: Record<string, unknown>) {
    state.isDemoMode = payload.isDemoMode as boolean;
    const ctx = payload.activeContext as { name: string } | null;
    state.activeContextName = ctx?.name ?? null;

    forwardToContentScripts({
        id: '',
        type: 'event',
        action: 'state_changed',
        payload,
        timestamp: new Date().toISOString(),
    });

    broadcastStateToPopup();
}

function handlePatternCacheSync(payload: Record<string, unknown>) {
    // Persist to chrome.storage.local for offline use
    chrome.storage.local.set({
        patternCache: payload,
        patternCacheTimestamp: Date.now(),
    });

    const patternArray = payload.patternArray as unknown[];
    state.patternCount = patternArray?.length ?? 0;

    forwardToContentScripts({
        id: '',
        type: 'event',
        action: 'pattern_cache_sync',
        payload,
        timestamp: new Date().toISOString(),
    });

    broadcastStateToPopup();
}

function handleKeyUpdated(payload: Record<string, unknown>) {
    forwardToContentScripts({
        id: '',
        type: 'event',
        action: 'key_updated',
        payload,
        timestamp: new Date().toISOString(),
    });
}

// MARK: - Content Script Communication

function forwardToContentScripts(message: IPCMessage) {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => {
                    // Tab doesn't have content script injected — normal for non-matching URLs
                });
            }
        }
    });
}

// MARK: - Popup Communication

function broadcastStateToPopup() {
    chrome.runtime.sendMessage({ type: 'state_update', state }).catch(() => {
        // Popup not open — ignore
    });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'get_state') {
        sendResponse(state);
        return true;
    }

    if (message.type === 'toggle_demo_mode') {
        sendRequestToCore('toggle_demo_mode', {});
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'request_paste') {
        sendRequestToCore('request_paste', { keyId: message.keyId });
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'submit_detected') {
        sendRequestToCore('submit_detected', message.payload);
        sendResponse({ ok: true });
        return true;
    }

    return false;
});

// MARK: - Reconnection

function scheduleReconnect() {
    if (reconnectTimer) return;
    const jitter = Math.random() * 1000;
    const delay = Math.min(reconnectDelay + jitter, MAX_RECONNECT_DELAY);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
    }, delay);
}

// MARK: - Lifecycle

// Start connection on install/startup
connect();

// Reconnect when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
    connect();
});

chrome.runtime.onInstalled.addListener(() => {
    connect();
});
