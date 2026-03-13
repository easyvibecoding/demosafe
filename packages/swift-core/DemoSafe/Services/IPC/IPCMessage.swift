import Foundation

/// JSON envelope for all IPC messages.
struct IPCMessage: Codable {
    let id: UUID
    let type: MessageType
    let action: String
    let payload: [String: AnyCodable]
    let timestamp: Date

    enum MessageType: String, Codable {
        case request
        case response
        case event
    }
}

/// IPC event types broadcast from Core to extensions.
enum IPCEvent {
    case stateChanged(isDemoMode: Bool, activeContextId: UUID?)
    case patternCacheSync(version: Int, patterns: [PatternCacheEntry])
    case keyUpdated(action: KeyAction, keyId: UUID, pattern: String?)
    case clipboardCleared(timestamp: Date)

    enum KeyAction: String, Codable {
        case add, update, delete
    }
}

/// Pattern cache entry sent to extensions (never contains plaintext).
struct PatternCacheEntry: Codable {
    let keyId: UUID
    let serviceId: UUID
    let serviceName: String
    let pattern: String
    let maskFormat: MaskFormat
    let maskedPreview: String
}
