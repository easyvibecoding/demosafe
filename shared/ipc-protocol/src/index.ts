/**
 * IPC Protocol Types — Source of Truth.
 * TypeScript definitions used by VS Code Extension and Chrome Extension.
 * Swift types are generated via codegen script.
 */

// === Message Envelope ===

export type MessageType = 'request' | 'response' | 'event';

export interface IPCMessage {
    id: string;
    type: MessageType;
    action: string;
    payload: Record<string, unknown>;
    timestamp: string; // ISO8601
}

// === Request Actions (Extension → Core) ===

export type RequestAction =
    | 'handshake'
    | 'get_state'
    | 'request_paste'
    | 'request_paste_group'
    | 'submit_detected'
    | 'resolve_mask';

export interface HandshakePayload {
    clientType: 'vscode' | 'chrome' | 'accessibility' | 'nmh';
    token: string;
    version: string;
}

export interface RequestPastePayload {
    keyId: string;
}

export interface RequestPasteGroupPayload {
    groupId: string;
    fieldIndex?: number;
}

export interface SubmitDetectedPayload {
    rawValue: string;
    suggestedService?: string;
    pattern: string;
    confidence: number;
}

export interface ResolveMaskPayload {
    keyId: string;
    maskText: string;
}

// === Event Actions (Core → Extension) ===

export type EventAction =
    | 'state_changed'
    | 'pattern_cache_sync'
    | 'key_updated'
    | 'clipboard_cleared';

export interface StateChangedPayload {
    isDemoMode: boolean;
    activeContext: {
        id: string;
        name: string;
        maskingLevel: MaskingLevel;
    } | null;
}

export interface PatternCacheSyncPayload {
    version: number;
    patternArray: PatternCacheEntry[];
    knownKeyLocations: KnownKeyLocation[];
}

export interface PatternCacheEntry {
    keyId: string;
    serviceId: string;
    serviceName: string;
    pattern: string;
    maskFormat: MaskFormat;
    maskedPreview: string;
}

export interface KnownKeyLocation {
    keyId: string;
    filePaths: string[];
    lastSeen: string; // ISO8601
}

export interface KeyUpdatedPayload {
    action: 'add' | 'update' | 'delete';
    keyId: string;
    pattern?: string;
}

export interface ClipboardClearedPayload {
    timestamp: string; // ISO8601
}

// === Shared Types ===

export type MaskingLevel = 'full' | 'partial' | 'off';

export interface MaskFormat {
    showPrefix: number;
    showSuffix: number;
    maskChar: string;
    separator: string;
}

// === Error Codes ===

export type ErrorCode =
    | 'AUTH_FAILED'
    | 'KEY_NOT_FOUND'
    | 'GROUP_NOT_FOUND'
    | 'DEMO_MODE_DENIED'
    | 'KEYCHAIN_ERROR'
    | 'INVALID_PAYLOAD';

export interface ErrorPayload {
    status: 'error';
    code: ErrorCode;
    message: string;
}
