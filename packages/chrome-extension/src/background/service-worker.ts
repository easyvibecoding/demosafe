/**
 * Background Service Worker — maintains WebSocket connection to DemoSafe Core.
 * Uses Native Messaging Host to read ipc.json for connection info.
 * Falls back to NMH relay when WebSocket is disconnected.
 *
 * Responsibilities:
 * - WebSocket lifecycle (connect, handshake, reconnect with exponential backoff)
 * - NMH fallback for critical actions (get_state, submit_captured_key, toggle_demo_mode)
 * - Forward Core events to content scripts
 * - Persist pattern cache to chrome.storage.local
 * - Respond to popup/options requests
 * - Manage Active Key Capture mode with alarm-based timeout
 * - Queue failed submissions for retry on reconnect
 */

const NATIVE_HOST_ID = 'com.demosafe.nmh';
const MAX_RECONNECT_DELAY = 30000;
const CAPTURE_TIMEOUT_MS = 300_000; // 5 minutes
const CAPTURE_ALARM_NAME = 'demosafe_capture_timeout';
const WS_REQUEST_TIMEOUT = 5000;

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

type ConnectionPath = 'ws' | 'nmh' | 'offline';

interface DemoSafeState {
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
    isCaptureMode: boolean;
    captureTimeoutEnd: number | null; // timestamp ms
    capturedCount: number;
    connectionPath: ConnectionPath;
}

// NMH relay actions — these can be forwarded via Native Messaging Host when WS is down
const NMH_RELAY_ACTIONS = new Set(['get_state', 'submit_captured_key', 'toggle_demo_mode']);

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Pending WS request tracking (request-response correlation)
const pendingRequests = new Map<string, { resolve: (response: IPCMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

const state: DemoSafeState = {
    isConnected: false,
    isDemoMode: false,
    activeContextName: null,
    patternCount: 0,
    isCaptureMode: false,
    captureTimeoutEnd: null,
    capturedCount: 0,
    connectionPath: 'offline',
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
                if (chrome.runtime.lastError) {
                    console.warn('[DemoSafe BG] getNativeConfig error:', chrome.runtime.lastError.message);
                    resolve(null);
                } else if (!response) {
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

// MARK: - NMH Relay (fallback path)

async function sendViaNMH(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendNativeMessage(
                NATIVE_HOST_ID,
                { action, payload },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn(`[DemoSafe NMH] ${action} native error:`, chrome.runtime.lastError.message);
                        resolve(null);
                    } else if (!response) {
                        console.warn(`[DemoSafe NMH] ${action}: no response`);
                        resolve(null);
                    } else if (response.error) {
                        console.warn(`[DemoSafe NMH] ${action} error:`, response.error, response.message);
                        resolve(null);
                    } else {
                        resolve(response as Record<string, unknown>);
                    }
                }
            );
        } catch (e) {
            console.warn(`[DemoSafe NMH] ${action} exception:`, e);
            resolve(null);
        }
    });
}

// MARK: - Unified Request Dispatch

/**
 * Send a request to Core, trying WS first, then NMH fallback for relay-eligible actions.
 * For submit_captured_key, queues to storage if both paths fail.
 */
async function sendRequest(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    // Try WebSocket first
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            const response = await sendRequestViaWS(action, payload);
            if (response) return response.payload as Record<string, unknown>;
        } catch (err) {
            console.warn(`[DemoSafe BG] WS request '${action}' failed, trying NMH fallback:`, err);
        }
    }

    // Try NMH fallback for relay-eligible actions
    if (NMH_RELAY_ACTIONS.has(action)) {
        const nmhResponse = await sendViaNMH(action, payload);
        if (nmhResponse && !nmhResponse.error) {
            // Extract payload from the full IPC response envelope
            const responsePayload = nmhResponse.payload as Record<string, unknown> | undefined;
            if (responsePayload) {
                state.connectionPath = 'nmh';
                return responsePayload;
            }
            // If response has no payload wrapper, it's already the payload
            state.connectionPath = 'nmh';
            return nmhResponse;
        }
    }

    // Both failed — do NOT queue plaintext keys to chrome.storage (security red line)
    if (action === 'submit_captured_key') {
        console.warn('[DemoSafe BG] submit_captured_key failed via both WS and NMH — key not stored');
    }

    state.connectionPath = 'offline';
    return null;
}

// MARK: - WS Request-Response Tracking

function sendRequestViaWS(action: string, payload: Record<string, unknown>): Promise<IPCMessage> {
    return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('WS request timeout'));
        }, WS_REQUEST_TIMEOUT);

        pendingRequests.set(id, { resolve, reject, timer });

        sendToCore({
            id,
            type: 'request',
            action,
            payload,
            timestamp: new Date().toISOString(),
        });
    });
}

function resolvePendingRequest(message: IPCMessage) {
    const pending = pendingRequests.get(message.id);
    if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(message.id);
        pending.resolve(message);
    }
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
        state.connectionPath = 'offline';
        scheduleReconnect();
        return;
    }

    try {
        ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
    } catch {
        state.isConnected = false;
        state.connectionPath = 'offline';
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
        } catch (err) {
            console.warn('[DemoSafe BG] Failed to parse WS message:', err);
        }
    };

    ws.onclose = () => {
        state.isConnected = false;
        state.connectionPath = 'offline';
        // Reject all pending WS requests so sendRequest can fall through to NMH
        for (const [, pending] of pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('WebSocket closed'));
        }
        pendingRequests.clear();
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
    // Resolve any pending request-response
    if (message.type === 'response') {
        resolvePendingRequest(message);
    }

    if (message.type === 'response' && message.action === 'handshake') {
        if (message.payload.status === 'success') {
            state.isConnected = true;
            state.connectionPath = 'ws';
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
        // If WS is disconnected, try NMH to get fresh state
        if (!state.isConnected) {
            sendViaNMH('get_state', {}).then((nmhResponse) => {
                if (nmhResponse && !nmhResponse.error) {
                    const payload = (nmhResponse.payload ?? nmhResponse) as Record<string, unknown>;
                    state.isDemoMode = (payload.isDemoMode as boolean) ?? state.isDemoMode;
                    // NMH is one-shot relay, not a persistent connection — don't claim isConnected
                    state.connectionPath = 'nmh';
                }
                sendResponse(state);
            });
        } else {
            sendResponse(state);
        }
        return true;
    }

    if (message.type === 'toggle_demo_mode') {
        sendRequest('toggle_demo_mode', {}).then((result) => {
            if (result) {
                state.isDemoMode = (result.isDemoMode as boolean) ?? state.isDemoMode;
                broadcastStateToPopup();
            }
        });
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'toggle_capture_mode') {
        const newState = !state.isCaptureMode;
        if (newState) state.capturedCount = 0;
        updateCaptureState(newState);
        sendRequest('toggle_capture_mode', { isActive: newState });
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'submit_captured_key') {
        console.log('[DemoSafe BG] submit_captured_key received:', message.payload?.suggestedService, 'connected:', state.isConnected, 'rawValue length:', message.payload?.rawValue?.length);
        sendRequest('submit_captured_key', message.payload).then((result) => {
            if (result) {
                console.log('[DemoSafe BG] submit_captured_key success via', state.connectionPath);
            } else {
                console.log('[DemoSafe BG] submit_captured_key queued for retry');
            }
        });
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

// DEBUG: uncomment to expose debug functions on SW DevTools console
// Object.assign(self, {
//     debugState: () => { console.log(JSON.stringify(state, null, 2)); return state; },
//     debugDisconnectWS: () => {
//         if (ws) { ws.onclose = null; ws.close(); ws = null; }
//         if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
//         state.isConnected = false;
//         state.connectionPath = 'offline';
//         broadcastStateToPopup();
//         console.log('[DEBUG] WS disconnected, reconnect disabled');
//     },
//     debugReconnectWS: () => { reconnectDelay = 1000; connect(); },
// });

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
