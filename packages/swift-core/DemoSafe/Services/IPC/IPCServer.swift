import Foundation
import Network
import os

private let ipcLogger = Logger(subsystem: "com.demosafe", category: "IPCServer")

/// Localhost WebSocket server for extension communication.
/// Binds ONLY to 127.0.0.1 — external interfaces are forbidden (security red line).
final class IPCServer {
    private let maskingCoordinator: MaskingCoordinator
    private let clipboardEngine: ClipboardEngine
    private let vaultManager: VaultManager
    private var listener: NWListener?
    private var connections: [UUID: ClientConnection] = [:]
    private var handshakeToken: String = ""
    private let ipcDir: URL
    private let ipcFileURL: URL

    struct ClientConnection {
        let id: UUID
        var clientType: ClientType
        let connection: NWConnection
        var isAuthenticated: Bool
    }

    enum ClientType: String, Codable {
        case vscode
        case chrome
        case accessibility
        case nmh
    }

    struct ClientInfo: Identifiable {
        let id: UUID
        let clientType: ClientType
    }

    private let sequentialPasteEngine: SequentialPasteEngine

    init(maskingCoordinator: MaskingCoordinator, clipboardEngine: ClipboardEngine, vaultManager: VaultManager, keychainService: KeychainService) {
        self.maskingCoordinator = maskingCoordinator
        self.clipboardEngine = clipboardEngine
        self.vaultManager = vaultManager
        self.sequentialPasteEngine = SequentialPasteEngine(clipboardEngine: clipboardEngine, keychainService: keychainService)
        let home = FileManager.default.homeDirectoryForCurrentUser
        self.ipcDir = home.appendingPathComponent(".demosafe")
        self.ipcFileURL = ipcDir.appendingPathComponent("ipc.json")

        // Listen for state changes from MaskingCoordinator
        NotificationCenter.default.addObserver(forName: Notification.Name("MaskingCoordinator.stateDidChange"), object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.broadcast(event: .stateChanged(
                isDemoMode: maskingCoordinator.isDemoMode,
                activeContextId: maskingCoordinator.activeContext?.id
            ))
        }

        // Listen for clipboard cleared
        NotificationCenter.default.addObserver(forName: Notification.Name("ClipboardEngine.clipboardCleared"), object: nil, queue: .main) { [weak self] _ in
            self?.broadcast(event: .clipboardCleared(timestamp: Date()))
        }
    }

    // MARK: - Public API

    /// Start WebSocket server on 127.0.0.1. Returns the actual bound port.
    func start(preferredPort: UInt16? = nil) throws -> UInt16 {
        // Generate cryptographically secure handshake token
        handshakeToken = generateToken()

        // Configure WebSocket over TCP
        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        params.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)
        // Force bind to localhost only
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: 0)

        if let port = preferredPort {
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } else {
            listener = try NWListener(using: params)
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let port = self?.listener?.port?.rawValue {
                    try? self?.writeIPCFile(port: port)
                }
            case .failed(let error):
                print("[IPCServer] Listener failed: \(error)")
                self?.listener?.cancel()
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleNewConnection(connection)
        }

        listener?.start(queue: .main)

        guard let port = listener?.port?.rawValue else {
            throw IPCError.bindFailed
        }

        return port
    }

    /// Stop the server and close all connections.
    func stop() {
        listener?.cancel()
        listener = nil
        for (_, client) in connections {
            client.connection.cancel()
        }
        connections.removeAll()
        cleanupIPCFile()
    }

    /// Broadcast event to specific client type or all connected clients.
    func broadcast(event: IPCEvent, to clientType: ClientType? = nil) {
        let targets: [ClientConnection]
        if let type = clientType {
            targets = connections.values.filter { $0.clientType == type && $0.isAuthenticated }
        } else {
            // Skip .nmh clients — they are short-lived relay connections, not event subscribers
            targets = connections.values.filter { $0.isAuthenticated && $0.clientType != .nmh }
        }

        guard let data = encodeEvent(event) else { return }

        for client in targets {
            sendData(data, to: client.connection)
        }
    }

    /// Get list of connected clients.
    func connectedClients() -> [ClientInfo] {
        return connections.values
            .filter { $0.isAuthenticated }
            .map { ClientInfo(id: $0.id, clientType: $0.clientType) }
    }

    // MARK: - Errors

    enum IPCError: Error {
        case bindFailed
        case tokenGenerationFailed
    }

    // MARK: - Private — Connection handling

    private func handleNewConnection(_ connection: NWConnection) {
        let clientId = UUID()
        let client = ClientConnection(
            id: clientId,
            clientType: .vscode, // Will be updated on handshake
            connection: connection,
            isAuthenticated: false
        )
        connections[clientId] = client

        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.connections.removeValue(forKey: clientId)
            default:
                break
            }
        }

        connection.start(queue: .main)
        receiveMessage(clientId: clientId, connection: connection)
    }

    private func receiveMessage(clientId: UUID, connection: NWConnection) {
        connection.receiveMessage { [weak self] data, context, _, error in
            if let error = error {
                self?.connections.removeValue(forKey: clientId)
                connection.cancel()
                return
            }

            if let data = data, !data.isEmpty {
                // Check WebSocket metadata for opcode
                if let context = context,
                   let metadata = context.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata {
                    switch metadata.opcode {
                    case .text:
                        self?.handleMessage(data, clientId: clientId)
                    case .close:
                        self?.connections.removeValue(forKey: clientId)
                        connection.cancel()
                        return
                    default:
                        break
                    }
                } else {
                    self?.handleMessage(data, clientId: clientId)
                }
            }

            // Continue receiving next message
            self?.receiveMessage(clientId: clientId, connection: connection)
        }
    }

    private func handleMessage(_ data: Data, clientId: UUID) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = json["action"] as? String,
              let messageId = json["id"] as? String,
              let payload = json["payload"] as? [String: Any] else {
            ipcLogger.warning("Failed to parse message")
            return
        }
        ipcLogger.warning("handleMessage: action=\(action) authenticated=\(self.connections[clientId]?.isAuthenticated ?? false)")

        switch action {
        case "handshake":
            handleHandshake(messageId: messageId, payload: payload, clientId: clientId)
        case "get_state":
            handleGetState(messageId: messageId, clientId: clientId)
        case "request_paste":
            handleRequestPaste(messageId: messageId, payload: payload, clientId: clientId)
        case "toggle_demo_mode":
            handleToggleDemoMode(messageId: messageId, clientId: clientId)
        case "submit_detected":
            handleSubmitDetected(messageId: messageId, payload: payload, clientId: clientId)
        case "submit_captured_key":
            handleSubmitCapturedKey(messageId: messageId, payload: payload, clientId: clientId)
        case "toggle_capture_mode":
            handleToggleCaptureMode(messageId: messageId, payload: payload, clientId: clientId)
        case "request_paste_group":
            handleRequestPasteGroup(messageId: messageId, payload: payload, clientId: clientId)
        default:
            sendError(messageId: messageId, action: action, code: "INVALID_PAYLOAD", message: "Unknown action: \(action)", clientId: clientId)
        }
    }

    // MARK: - Private — Request handlers

    private func handleHandshake(messageId: String, payload: [String: Any], clientId: UUID) {
        guard let token = payload["token"] as? String,
              let clientTypeStr = payload["clientType"] as? String,
              let clientType = ClientType(rawValue: clientTypeStr) else {
            sendError(messageId: messageId, action: "handshake", code: "INVALID_PAYLOAD", message: "Missing token or clientType", clientId: clientId)
            return
        }

        guard token == handshakeToken else {
            sendError(messageId: messageId, action: "handshake", code: "AUTH_FAILED", message: "Invalid handshake token", clientId: clientId)
            return
        }

        // Authenticate client
        connections[clientId]?.isAuthenticated = true
        connections[clientId]?.clientType = clientType

        // Respond with state + full pattern cache
        let entries = maskingCoordinator.patternCacheEntries()
        let response: [String: Any] = [
            "id": messageId,
            "type": "response",
            "action": "handshake",
            "payload": [
                "status": "success",
                "isDemoMode": maskingCoordinator.isDemoMode,
                "patternCacheVersion": maskingCoordinator.patternCacheVersion,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        sendJSON(response, clientId: clientId)

        // Send full pattern cache sync
        broadcast(event: .patternCacheSync(
            version: maskingCoordinator.patternCacheVersion,
            patterns: entries
        ), to: clientType)
    }

    private func handleGetState(messageId: String, clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "get_state", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        let response: [String: Any] = [
            "id": messageId,
            "type": "response",
            "action": "get_state",
            "payload": [
                "isDemoMode": maskingCoordinator.isDemoMode,
                "activeContext": maskingCoordinator.activeContext.map { [
                    "id": $0.id.uuidString,
                    "name": $0.name,
                    "maskingLevel": $0.maskingLevel.rawValue,
                ] } as Any,
                "patternCacheVersion": maskingCoordinator.patternCacheVersion,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        sendJSON(response, clientId: clientId)
    }

    private func handleToggleDemoMode(messageId: String, clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "toggle_demo_mode", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.maskingCoordinator.isDemoMode.toggle()
            self.maskingCoordinator.broadcastState()

            let response: [String: Any] = [
                "id": messageId,
                "type": "response",
                "action": "toggle_demo_mode",
                "payload": [
                    "status": "success",
                    "isDemoMode": self.maskingCoordinator.isDemoMode,
                ],
                "timestamp": ISO8601DateFormatter().string(from: Date()),
            ]
            self.sendJSON(response, clientId: clientId)
        }
    }

    private func handleRequestPaste(messageId: String, payload: [String: Any], clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "request_paste", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        guard let keyIdStr = payload["keyId"] as? String,
              let keyId = UUID(uuidString: keyIdStr) else {
            sendError(messageId: messageId, action: "request_paste", code: "INVALID_PAYLOAD", message: "Missing or invalid keyId", clientId: clientId)
            return
        }

        do {
            try clipboardEngine.copyToClipboard(keyId: keyId)
            let response: [String: Any] = [
                "id": messageId,
                "type": "response",
                "action": "request_paste",
                "payload": ["status": "success"],
                "timestamp": ISO8601DateFormatter().string(from: Date()),
            ]
            sendJSON(response, clientId: clientId)
        } catch {
            sendError(messageId: messageId, action: "request_paste", code: "KEYCHAIN_ERROR", message: error.localizedDescription, clientId: clientId)
        }
    }

    private func handleSubmitDetected(messageId: String, payload: [String: Any], clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "submit_detected", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        // For now, acknowledge receipt. Full implementation will check vault for duplicates.
        let response: [String: Any] = [
            "id": messageId,
            "type": "response",
            "action": "submit_detected",
            "payload": ["isStored": false],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        sendJSON(response, clientId: clientId)
    }

    private func handleSubmitCapturedKey(messageId: String, payload: [String: Any], clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "submit_captured_key", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        guard let rawValue = payload["rawValue"] as? String,
              let suggestedService = payload["suggestedService"] as? String else {
            sendError(messageId: messageId, action: "submit_captured_key", code: "INVALID_PAYLOAD", message: "Missing rawValue or suggestedService", clientId: clientId)
            return
        }

        let confidence = payload["confidence"] as? Double ?? 0.5
        let sourceURL = payload["sourceURL"] as? String ?? ""

        // Low confidence — require confirmation (respond but don't store yet)
        if confidence < 0.7 {
            let response: [String: Any] = [
                "id": messageId,
                "type": "response",
                "action": "submit_captured_key",
                "payload": [
                    "status": "low_confidence",
                    "requiresConfirmation": true,
                    "suggestedService": suggestedService,
                    "sourceURL": sourceURL,
                ],
                "timestamp": ISO8601DateFormatter().string(from: Date()),
            ]
            sendJSON(response, clientId: clientId)
            return
        }

        // Find or create service
        ipcLogger.warning("submit_captured_key: service=\(suggestedService) confidence=\(confidence) rawLen=\(rawValue.count)")
        DispatchQueue.main.async { [weak self] in
            guard let self else { ipcLogger.error("self is nil in submit_captured_key"); return }

            var service = self.vaultManager.getAllServices().first(where: { $0.name == suggestedService })
            ipcLogger.warning("existing service: \(service?.name ?? "nil")")
            if service == nil {
                let defaultPattern = ".*" // Generic fallback pattern
                let newService = Service(
                    id: UUID(), name: suggestedService, icon: nil,
                    defaultPattern: defaultPattern, defaultMaskFormat: .default, isBuiltIn: false
                )
                try? self.vaultManager.addService(newService)
                service = newService
            }

            guard let svc = service, let valueData = rawValue.data(using: .utf8) else {
                self.sendError(messageId: messageId, action: "submit_captured_key", code: "STORE_FAILED", message: "Failed to encode value", clientId: clientId)
                return
            }

            // Deduplicate: check if this exact key value already exists in Keychain
            if let existing = self.vaultManager.isDuplicateKey(serviceId: svc.id, value: valueData) {
                ipcLogger.warning("submit_captured_key: duplicate key, skipping store")
                let response: [String: Any] = [
                    "id": messageId, "type": "response", "action": "submit_captured_key",
                    "payload": ["status": "duplicate", "label": existing.label, "serviceName": suggestedService],
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]
                self.sendJSON(response, clientId: clientId)
                return
            }

            // Generate a simple label from service + timestamp
            let label = "\(suggestedService.lowercased())-\(Int(Date().timeIntervalSince1970) % 100000)"

            // Use structural pattern from Extension (e.g. "sk-proj-[A-Za-z0-9_-]{20,}")
            // Never store the literal key value as pattern — that would leak plaintext via IPC broadcast
            let structuralPattern: String
            if let extensionPattern = payload["pattern"] as? String, !extensionPattern.isEmpty {
                structuralPattern = extensionPattern
            } else {
                // Fallback: derive pattern from key structure (prefix + char class + length)
                structuralPattern = Self.deriveStructuralPattern(from: rawValue)
            }

            do {
                ipcLogger.warning("storing key: label=\(label) patternLen=\(structuralPattern.count)")
                _ = try self.vaultManager.addKey(
                    label: label,
                    serviceId: svc.id,
                    pattern: structuralPattern,
                    maskFormat: svc.defaultMaskFormat,
                    value: valueData
                )
                ipcLogger.warning("key stored successfully")

                // pattern_cache_sync is automatically broadcast via NotificationCenter

                let response: [String: Any] = [
                    "id": messageId,
                    "type": "response",
                    "action": "submit_captured_key",
                    "payload": [
                        "status": "success",
                        "label": label,
                        "serviceName": suggestedService,
                    ],
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]
                self.sendJSON(response, clientId: clientId)
            } catch {
                ipcLogger.error("FAILED to store key: \(error)")
                self.sendError(messageId: messageId, action: "submit_captured_key", code: "STORE_FAILED", message: "Failed to store key: \(error)", clientId: clientId)
            }
        }
    }

    private func handleToggleCaptureMode(messageId: String, payload: [String: Any], clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "toggle_capture_mode", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        let isActive = payload["isActive"] as? Bool ?? false

        // Broadcast to all connected clients
        let event: [String: Any] = [
            "id": UUID().uuidString,
            "type": "event",
            "action": "capture_mode_changed",
            "payload": [
                "isActive": isActive,
                "timeout": 300,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if let data = try? JSONSerialization.data(withJSONObject: event) {
            for (_, client) in connections where client.isAuthenticated {
                sendData(data, to: client.connection)
            }
        }

        let response: [String: Any] = [
            "id": messageId,
            "type": "response",
            "action": "toggle_capture_mode",
            "payload": ["status": "success", "isActive": isActive],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        sendJSON(response, clientId: clientId)
    }

    private func handleRequestPasteGroup(messageId: String, payload: [String: Any], clientId: UUID) {
        guard connections[clientId]?.isAuthenticated == true else {
            sendError(messageId: messageId, action: "request_paste_group", code: "AUTH_FAILED", message: "Not authenticated", clientId: clientId)
            return
        }

        guard let groupIdStr = payload["groupId"] as? String,
              let groupId = UUID(uuidString: groupIdStr) else {
            sendError(messageId: messageId, action: "request_paste_group", code: "INVALID_PAYLOAD", message: "Missing or invalid groupId", clientId: clientId)
            return
        }

        guard let group = vaultManager.getLinkedGroup(groupId: groupId) else {
            sendError(messageId: messageId, action: "request_paste_group", code: "GROUP_NOT_FOUND", message: "Group not found: \(groupId)", clientId: clientId)
            return
        }

        let fieldIndex = payload["fieldIndex"] as? Int

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            if let fieldIndex = fieldIndex {
                // SelectField mode: paste single field
                do {
                    try self.sequentialPasteEngine.pasteField(group, fieldIndex: fieldIndex, autoClearSeconds: nil)
                    let response: [String: Any] = [
                        "id": messageId,
                        "type": "response",
                        "action": "request_paste_group",
                        "payload": ["status": "success", "groupId": groupId.uuidString, "fieldIndex": fieldIndex],
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ]
                    self.sendJSON(response, clientId: clientId)
                } catch {
                    self.sendError(messageId: messageId, action: "request_paste_group", code: "KEYCHAIN_ERROR", message: error.localizedDescription, clientId: clientId)
                }
            } else {
                // Full group paste based on pasteMode
                switch group.pasteMode {
                case .sequential:
                    Task {
                        do {
                            try await self.sequentialPasteEngine.pasteGroupSequentially(group, autoClearSeconds: nil)
                            let response: [String: Any] = [
                                "id": messageId,
                                "type": "response",
                                "action": "request_paste_group",
                                "payload": ["status": "success", "groupId": groupId.uuidString],
                                "timestamp": ISO8601DateFormatter().string(from: Date()),
                            ]
                            self.sendJSON(response, clientId: clientId)
                        } catch {
                            self.sendError(messageId: messageId, action: "request_paste_group", code: "KEYCHAIN_ERROR", message: error.localizedDescription, clientId: clientId)
                        }
                    }
                case .selectField:
                    // SelectField without fieldIndex: paste first entry as fallback
                    do {
                        try self.sequentialPasteEngine.pasteField(group, fieldIndex: 0, autoClearSeconds: nil)
                        let response: [String: Any] = [
                            "id": messageId,
                            "type": "response",
                            "action": "request_paste_group",
                            "payload": ["status": "success", "groupId": groupId.uuidString, "fieldIndex": 0],
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ]
                        self.sendJSON(response, clientId: clientId)
                    } catch {
                        self.sendError(messageId: messageId, action: "request_paste_group", code: "KEYCHAIN_ERROR", message: error.localizedDescription, clientId: clientId)
                    }
                }
            }
        }
    }

    // MARK: - Private — Sending

    private func sendJSON(_ json: [String: Any], clientId: UUID) {
        guard let connection = connections[clientId]?.connection,
              let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        sendData(data, to: connection)
    }

    private func sendError(messageId: String, action: String, code: String, message: String, clientId: UUID) {
        let response: [String: Any] = [
            "id": messageId,
            "type": "response",
            "action": action,
            "payload": [
                "status": "error",
                "code": code,
                "message": message,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        sendJSON(response, clientId: clientId)
    }

    private func sendData(_ data: Data, to connection: NWConnection) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "ws", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { error in
            if let error = error {
                print("[IPCServer] Send error: \(error)")
            }
        })
    }

    private func encodeEvent(_ event: IPCEvent) -> Data? {
        var json: [String: Any] = [
            "id": UUID().uuidString,
            "type": "event",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        switch event {
        case .stateChanged(let isDemoMode, _):
            json["action"] = "state_changed"
            let ctx = maskingCoordinator.activeContext
            json["payload"] = [
                "isDemoMode": isDemoMode,
                "activeContext": ctx.map { [
                    "id": $0.id.uuidString,
                    "name": $0.name,
                    "maskingLevel": $0.maskingLevel.rawValue,
                ] } as Any,
            ]
        case .patternCacheSync(let version, let patterns):
            json["action"] = "pattern_cache_sync"
            let patternDicts: [[String: Any]] = patterns.map { p in
                [
                    "keyId": p.keyId.uuidString,
                    "serviceId": p.serviceId.uuidString,
                    "serviceName": p.serviceName,
                    "pattern": p.pattern,
                    "maskFormat": [
                        "showPrefix": p.maskFormat.showPrefix,
                        "showSuffix": p.maskFormat.showSuffix,
                        "maskChar": p.maskFormat.maskChar,
                        "separator": p.maskFormat.separator,
                    ],
                    "maskedPreview": p.maskedPreview,
                ]
            }
            json["payload"] = ["version": version, "patternArray": patternDicts]
        case .keyUpdated(let action, let keyId, let pattern):
            json["action"] = "key_updated"
            json["payload"] = [
                "action": action.rawValue,
                "keyId": keyId.uuidString,
                "pattern": pattern as Any,
            ]
        case .clipboardCleared(let timestamp):
            json["action"] = "clipboard_cleared"
            json["payload"] = ["timestamp": ISO8601DateFormatter().string(from: timestamp)]
        }

        return try? JSONSerialization.data(withJSONObject: json)
    }

    // MARK: - Private — Structural Pattern Derivation

    /// Derive a structural regex pattern from a raw key value.
    /// Preserves known prefix, replaces remainder with character class + exact length.
    /// e.g. "sk-proj-abc123XYZ" → "sk\\-proj\\-[A-Za-z0-9]{10}"
    /// This is the fallback when the Extension does not provide a pattern.
    static func deriveStructuralPattern(from rawValue: String) -> String {
        let knownPrefixes = [
            "sk-proj-", "sk-ant-api03-", "sk-ant-", "sk-or-v1-",
            "sk-", "pk-",
            "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
            "AKIA", "ASIA",
            "glpat-", "glsa-",
            "xoxb-", "xoxp-", "xoxe-",
            "key-", "token-", "api-", "secret-", "rk-",
            "AIza",
        ]

        var prefix = ""
        var remainder = rawValue
        // Match longest prefix first
        for p in knownPrefixes.sorted(by: { $0.count > $1.count }) {
            if rawValue.hasPrefix(p) {
                prefix = p
                remainder = String(rawValue.dropFirst(p.count))
                break
            }
        }

        let escapedPrefix = NSRegularExpression.escapedPattern(for: prefix)
        let charClass = Self.inferCharacterClass(remainder)
        let len = remainder.count

        return "\(escapedPrefix)\(charClass){\(len)}"
    }

    private static func inferCharacterClass(_ s: String) -> String {
        let hasUpper = s.range(of: "[A-Z]", options: .regularExpression) != nil
        let hasLower = s.range(of: "[a-z]", options: .regularExpression) != nil
        let hasDigit = s.range(of: "[0-9]", options: .regularExpression) != nil
        let hasUnderscore = s.contains("_")
        let hasDash = s.contains("-")
        let hasSlash = s.contains("/")
        let hasPlus = s.contains("+")
        let hasEquals = s.contains("=")

        var cls = ""
        if hasUpper { cls += "A-Z" }
        if hasLower { cls += "a-z" }
        if hasDigit { cls += "0-9" }
        if hasUnderscore { cls += "_" }
        if hasDash { cls += "\\-" }
        if hasSlash { cls += "/" }
        if hasPlus { cls += "\\+" }
        if hasEquals { cls += "=" }

        if cls.isEmpty { cls = "A-Za-z0-9" }

        return "[\(cls)]"
    }

    // MARK: - Private — Token & ipc.json

    /// Generate a 32-byte cryptographically secure random token (hex encoded = 64 chars).
    private func generateToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            // Fallback to UUID-based token (less secure but functional)
            return UUID().uuidString + UUID().uuidString
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Write ipc.json with chmod 600 permission.
    private func writeIPCFile(port: UInt16) throws {
        try FileManager.default.createDirectory(at: ipcDir, withIntermediateDirectories: true)

        let info: [String: Any] = [
            "port": Int(port),
            "pid": ProcessInfo.processInfo.processIdentifier,
            "version": "0.1.0",
            "token": handshakeToken,
        ]

        let data = try JSONSerialization.data(withJSONObject: info, options: .prettyPrinted)
        try data.write(to: ipcFileURL)

        // chmod 600 — security red line
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: ipcFileURL.path
        )
    }

    private func cleanupIPCFile() {
        try? FileManager.default.removeItem(at: ipcFileURL)
    }
}
