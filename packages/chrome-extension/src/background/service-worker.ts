/**
 * Background Service Worker — maintains WebSocket connection to DemoSafe Core.
 * Uses Native Messaging Host to read ipc.json for connection info.
 *
 * Responsibilities:
 * - WebSocket lifecycle (connect, handshake, reconnect with exponential backoff)
 * - Forward Core events to content scripts
 * - Persist pattern cache to chrome.storage.local
 * - Respond to popup/options requests
 * - Manage Active Key Capture mode with alarm-based timeout
 */

const NATIVE_HOST_ID = 'com.demosafe.nmh';
const MAX_RECONNECT_DELAY = 30000;
const CAPTURE_TIMEOUT_MS = 300_000; // 5 minutes
const CAPTURE_ALARM_NAME = 'demosafe_capture_timeout';

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
    isCaptureMode: boolean;
    captureTimeoutEnd: number | null; // timestamp ms
    capturedCount: number;
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const state: DemoSafeState = {
    isConnected: false,
    isDemoMode: false,
    activeContextName: null,
    patternCount: 0,
    isCaptureMode: false,
    captureTimeoutEnd: null,
    capturedCount: 0,
};

// MARK: - Native Messaging Host

async function getIPCConfig(): Promise<IPCConfig | null> {
    const nativeConfig = await getNativeConfig();
    if (nativeConfig) return nativeConfig;

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

// MARK: - Message Handling (from Core)

function handleMessage(message: IPCMessage) {
    if (message.type === 'response' && message.action === 'handshake') {
        if (message.payload.status === 'success') {
            state.isConnected = true;
            state.isDemoMode = message.payload.isDemoMode as boolean;
            broadcastStateToPopup();
        }
        return;
    }

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
                forwardToContentScripts(message);
                break;
            case 'capture_mode_changed':
                handleCaptureModeEvent(message.payload);
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

// MARK: - Capture Mode Management

function handleCaptureModeEvent(payload: Record<string, unknown>) {
    const isActive = payload.isActive as boolean;
    updateCaptureState(isActive);
}

function updateCaptureState(isActive: boolean) {
    state.isCaptureMode = isActive;

    if (isActive) {
        state.captureTimeoutEnd = Date.now() + CAPTURE_TIMEOUT_MS;
        chrome.alarms.create(CAPTURE_ALARM_NAME, { delayInMinutes: CAPTURE_TIMEOUT_MS / 60000 });
    } else {
        state.captureTimeoutEnd = null;
        chrome.alarms.clear(CAPTURE_ALARM_NAME);
    }

    // Broadcast to all content scripts
    forwardToContentScripts({
        id: '',
        type: 'event',
        action: 'capture_mode_changed',
        payload: {
            isActive,
            timeout: isActive ? CAPTURE_TIMEOUT_MS / 1000 : 0,
        },
        timestamp: new Date().toISOString(),
    });

    broadcastStateToPopup();
}

function disableCaptureMode() {
    state.isCaptureMode = false;
    state.captureTimeoutEnd = null;
    chrome.alarms.clear(CAPTURE_ALARM_NAME);

    forwardToContentScripts({
        id: '',
        type: 'event',
        action: 'capture_mode_changed',
        payload: { isActive: false, timeout: 0 },
        timestamp: new Date().toISOString(),
    });

    broadcastStateToPopup();
}

// Alarm handler for MV3-safe timeout
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CAPTURE_ALARM_NAME) {
        disableCaptureMode();
    }
});

// MARK: - Content Script Communication

function forwardToContentScripts(message: IPCMessage) {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => {});
            }
        }
    });
}

// MARK: - Popup Communication

function broadcastStateToPopup() {
    chrome.runtime.sendMessage({ type: 'state_update', state }).catch(() => {});
}

// Listen for messages from popup and content scripts
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

    if (message.type === 'toggle_capture_mode') {
        const newState = !state.isCaptureMode;
        if (newState) state.capturedCount = 0;
        updateCaptureState(newState);
        if (state.isConnected) {
            sendRequestToCore('toggle_capture_mode', { isActive: newState });
        }
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'submit_captured_key') {
        if (state.isConnected) {
            sendRequestToCore('submit_captured_key', message.payload);
        }
        state.capturedCount++;
        broadcastStateToPopup();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'capture_timed_out') {
        disableCaptureMode();
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

connect();

chrome.runtime.onStartup.addListener(() => {
    connect();
});

chrome.runtime.onInstalled.addListener(() => {
    connect();
});
