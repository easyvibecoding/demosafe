import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { PatternCache, PatternEntry } from '../core/pattern-cache';

interface IPCConfig {
    port: number;
    pid: number;
    version: string;
    token: string;
}

interface IPCMessage {
    id: string;
    type: 'request' | 'response' | 'event';
    action: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

interface StateChangedPayload {
    isDemoMode: boolean;
    activeContext: {
        id: string;
        name: string;
        maskingLevel: string;
    } | null;
}

interface PatternCacheSyncPayload {
    version: number;
    patternArray: PatternEntry[];
}

interface KeyUpdatedPayload {
    action: 'add' | 'update' | 'delete';
    keyId: string;
    pattern?: string;
}

/**
 * WebSocket client connecting to DemoSafe Core on localhost.
 * Implements exponential backoff reconnection (1s → 2s → 4s → max 30s + jitter).
 *
 * Events emitted:
 * - 'connected': Successfully connected and handshake completed
 * - 'disconnected': Connection lost
 * - 'stateChanged': Demo mode or context changed
 * - 'patternsUpdated': Pattern cache was updated
 * - 'clipboardCleared': Clipboard was cleared by Core
 */
export class IPCClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private config: IPCConfig | null = null;
    private patternCache: PatternCache;
    private reconnectDelay = 1000;
    private maxReconnectDelay = 30000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _isConnected = false;
    private _isDemoMode = false;
    private _activeContextName: string | null = null;
    private pendingResponses = new Map<string, {
        resolve: (payload: Record<string, unknown>) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    constructor(patternCache: PatternCache) {
        super();
        this.patternCache = patternCache;
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    get isDemoMode(): boolean {
        return this._isDemoMode;
    }

    get activeContextName(): string | null {
        return this._activeContextName;
    }

    private log(msg: string) {
        this.emit('log', `[IPC] ${msg}`);
    }

    connect() {
        // Re-read ipc.json on each connection attempt (Core may have restarted)
        this.config = this.readIPCConfig();
        if (!this.config) {
            this.log('No ipc.json found, scheduling reconnect');
            this.scheduleReconnect();
            return;
        }

        const url = `ws://127.0.0.1:${this.config.port}`;
        this.log(`Connecting to ${url}`);

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            this.log(`WebSocket creation failed: ${e}`);
            this.scheduleReconnect();
            return;
        }

        this.ws.on('open', () => {
            this.log('WebSocket open, sending handshake');
            this.reconnectDelay = 1000;
            this.sendHandshake();
        });

        this.ws.on('message', (data) => {
            try {
                const message: IPCMessage = JSON.parse(data.toString());
                this.log(`Received: ${message.type} ${message.action}`);
                this.handleMessage(message);
            } catch (e) {
                this.log(`Parse error: ${e}`);
            }
        });

        this.ws.on('close', () => {
            this.log('WebSocket closed');
            this._isConnected = false;
            this.emit('disconnected');
            this.scheduleReconnect();
        });

        this.ws.on('error', (e) => {
            this.log(`WebSocket error: ${e.message}`);
            this.ws?.close();
        });
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Clear all pending responses
        for (const [, pending] of this.pendingResponses) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Disconnected'));
        }
        this.pendingResponses.clear();

        this.ws?.close();
        this.ws = null;
        this._isConnected = false;
    }

    /**
     * Send a request and wait for the response (with timeout).
     */
    async sendRequestAsync(action: string, payload: Record<string, unknown>, timeoutMs = 5000): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Not connected'));
                return;
            }

            const id = generateUUID();
            const timer = setTimeout(() => {
                this.pendingResponses.delete(id);
                reject(new Error(`Request ${action} timed out`));
            }, timeoutMs);

            this.pendingResponses.set(id, { resolve, reject, timer });

            const message: IPCMessage = {
                id,
                type: 'request',
                action,
                payload,
                timestamp: new Date().toISOString(),
            };
            this.ws.send(JSON.stringify(message));
        });
    }

    /**
     * Fire-and-forget request (no response handling).
     */
    sendRequest(action: string, payload: Record<string, unknown>) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const message: IPCMessage = {
            id: generateUUID(),
            type: 'request',
            action,
            payload,
            timestamp: new Date().toISOString(),
        };
        this.ws.send(JSON.stringify(message));
    }

    /**
     * Request paste via Core. Returns true if successful.
     */
    async requestPaste(keyId: string): Promise<boolean> {
        try {
            const result = await this.sendRequestAsync('request_paste', { keyId });
            return result.status === 'success';
        } catch {
            return false;
        }
    }

    /**
     * Submit a detected key to Core for storage consideration.
     */
    async submitDetected(rawValue: string, suggestedService: string | undefined, pattern: string, confidence: number): Promise<{ isStored: boolean; keyId?: string }> {
        try {
            const result = await this.sendRequestAsync('submit_detected', {
                rawValue,
                suggestedService,
                pattern,
                confidence,
            });
            return {
                isStored: result.isStored as boolean,
                keyId: result.keyId as string | undefined,
            };
        } catch {
            return { isStored: false };
        }
    }

    // MARK: - Private

    private sendHandshake() {
        if (!this.config) return;
        this.sendRequest('handshake', {
            clientType: 'vscode',
            token: this.config.token,
            version: '0.1.0',
        });
    }

    private handleMessage(message: IPCMessage) {
        // Handle responses to pending requests
        if (message.type === 'response') {
            const pending = this.pendingResponses.get(message.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingResponses.delete(message.id);

                const payload = message.payload;
                if (payload.status === 'error') {
                    pending.reject(new Error(`${payload.code}: ${payload.message}`));
                } else {
                    pending.resolve(payload);
                }
            }

            // Handshake success
            if (message.action === 'handshake' && message.payload.status === 'success') {
                this._isConnected = true;
                this._isDemoMode = message.payload.isDemoMode as boolean;
                this.emit('connected');
            }
            return;
        }

        // Handle events from Core
        if (message.type === 'event') {
            switch (message.action) {
                case 'state_changed':
                    this.handleStateChanged(message.payload as unknown as StateChangedPayload);
                    break;
                case 'pattern_cache_sync':
                    this.handlePatternCacheSync(message.payload as unknown as PatternCacheSyncPayload);
                    break;
                case 'key_updated':
                    this.handleKeyUpdated(message.payload as unknown as KeyUpdatedPayload);
                    break;
                case 'clipboard_cleared':
                    this.emit('clipboardCleared');
                    break;
            }
        }
    }

    private handleStateChanged(payload: StateChangedPayload) {
        this._isDemoMode = payload.isDemoMode;
        this._activeContextName = payload.activeContext?.name ?? null;
        this.emit('stateChanged', {
            isDemoMode: payload.isDemoMode,
            activeContext: payload.activeContext,
        });
    }

    private handlePatternCacheSync(payload: PatternCacheSyncPayload) {
        this.patternCache.updateFull(payload.version, payload.patternArray);
        this.emit('patternsUpdated');
    }

    private handleKeyUpdated(payload: KeyUpdatedPayload) {
        this.patternCache.updateIncremental(payload.action, payload.keyId, payload.pattern);
        this.emit('patternsUpdated');
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return; // Already scheduled
        const jitter = Math.random() * 1000;
        const delay = Math.min(this.reconnectDelay + jitter, this.maxReconnectDelay);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            this.connect();
        }, delay);
    }

    private readIPCConfig(): IPCConfig | null {
        const configPath = path.join(os.homedir(), '.demosafe', 'ipc.json');
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
}

function generateUUID(): string {
    // Node.js 19+ has crypto.randomUUID, fallback for older versions
    try {
        return crypto.randomUUID();
    } catch {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}
