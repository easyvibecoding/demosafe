import Foundation

/// Native Messaging Host for Chrome Extension.
/// Supports:
///   - get_config: Read ~/.demosafe/ipc.json and return {port, token}
///   - get_state / submit_captured_key / toggle_demo_mode: Relay via short-lived WS to Core
/// Protocol: Chrome Native Messaging (stdin/stdout with 4-byte length prefix).

struct IPCConfig: Codable {
    let port: Int
    let pid: Int
    let version: String
    let token: String
}

// MARK: - Chrome Native Messaging I/O

func readMessage() -> Data? {
    var lengthBytes = [UInt8](repeating: 0, count: 4)
    guard fread(&lengthBytes, 1, 4, stdin) == 4 else { return nil }
    let length = Int(lengthBytes[0]) | Int(lengthBytes[1]) << 8 | Int(lengthBytes[2]) << 16 | Int(lengthBytes[3]) << 24
    guard length > 0, length < 1_000_000 else { return nil }
    var buffer = [UInt8](repeating: 0, count: length)
    guard fread(&buffer, 1, length, stdin) == length else { return nil }
    return Data(buffer)
}

func writeMessage(_ data: Data) {
    var length = UInt32(data.count)
    fwrite(&length, 4, 1, stdout)
    _ = data.withUnsafeBytes { fwrite($0.baseAddress, 1, data.count, stdout) }
    fflush(stdout)
}

func writeJSON(_ dict: [String: Any]) {
    do {
        let data = try JSONSerialization.data(withJSONObject: dict)
        writeMessage(data)
    } catch {
        // Last-resort fallback: write a hardcoded error directly
        let fallback = Data(#"{"error":"encode_failed"}"#.utf8)
        writeMessage(fallback)
        fputs("NMH: writeJSON serialization failed: \(error)\n", stderr)
    }
}

func writeError(_ code: String, message: String = "") {
    writeJSON(["error": code, "message": message])
}

// MARK: - IPC Config

func loadIPCConfig() -> IPCConfig? {
    let configPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".demosafe/ipc.json")
    guard let data = try? Data(contentsOf: configPath),
          let config = try? JSONDecoder().decode(IPCConfig.self, from: data) else {
        return nil
    }
    return config
}

// MARK: - WebSocket Relay

let relayActions: Set<String> = ["get_state", "submit_captured_key", "toggle_demo_mode"]

/// Connect to Core WS, handshake, send one request, return one response, then close.
/// Uses DispatchQueue for URLSession callbacks; blocks main thread with semaphore.
func relayToCore(config: IPCConfig, action: String, payload: [String: Any]) -> [String: Any] {
    let semaphore = DispatchSemaphore(value: 0)
    var result: [String: Any] = ["error": "timeout"]

    // URLSession with delegate queue so callbacks don't need RunLoop
    let delegateQueue = OperationQueue()
    delegateQueue.name = "nmh.ws"
    let session = URLSession(configuration: .default, delegate: nil, delegateQueue: delegateQueue)

    let url = URL(string: "ws://127.0.0.1:\(config.port)")!
    let wsTask = session.webSocketTask(with: url)
    wsTask.resume()

    let messageId = UUID().uuidString

    // Step 1: Send handshake
    let handshake: [String: Any] = [
        "id": UUID().uuidString,
        "type": "request",
        "action": "handshake",
        "payload": ["clientType": "nmh", "token": config.token, "version": "0.1.0"],
        "timestamp": ISO8601DateFormatter().string(from: Date()),
    ]

    guard let handshakeData = try? JSONSerialization.data(withJSONObject: handshake),
          let handshakeStr = String(data: handshakeData, encoding: .utf8) else {
        return ["error": "encode_failed"]
    }

    wsTask.send(.string(handshakeStr)) { error in
        if error != nil {
            result = ["error": "core_unreachable"]
            semaphore.signal()
            return
        }

        // Step 2: Receive handshake response
        wsTask.receive { receiveResult in
            guard case .success(let msg) = receiveResult,
                  case .string(let text) = msg,
                  let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let hsPayload = json["payload"] as? [String: Any],
                  hsPayload["status"] as? String == "success" else {
                result = ["error": "auth_failed"]
                wsTask.cancel(with: .goingAway, reason: nil)
                semaphore.signal()
                return
            }

            // Step 3: Send the actual request
            let request: [String: Any] = [
                "id": messageId,
                "type": "request",
                "action": action,
                "payload": payload,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
            ]

            guard let reqData = try? JSONSerialization.data(withJSONObject: request),
                  let reqStr = String(data: reqData, encoding: .utf8) else {
                result = ["error": "encode_failed"]
                wsTask.cancel(with: .goingAway, reason: nil)
                semaphore.signal()
                return
            }

            wsTask.send(.string(reqStr)) { error in
                if error != nil {
                    result = ["error": "core_unreachable"]
                    wsTask.cancel(with: .goingAway, reason: nil)
                    semaphore.signal()
                    return
                }

                // Step 4: Receive response (skip event messages)
                receiveResponse(wsTask: wsTask, expectedId: messageId, attemptsLeft: 5) { response in
                    result = response
                    wsTask.cancel(with: .goingAway, reason: nil)
                    semaphore.signal()
                }
            }
        }
    }

    let timeout = DispatchTime.now() + .seconds(5)
    if semaphore.wait(timeout: timeout) == .timedOut {
        wsTask.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
        return ["error": "timeout"]
    }

    session.invalidateAndCancel()
    return result
}

func receiveResponse(wsTask: URLSessionWebSocketTask, expectedId: String, attemptsLeft: Int, completion: @escaping ([String: Any]) -> Void) {
    guard attemptsLeft > 0 else {
        completion(["error": "no_response"])
        return
    }

    wsTask.receive { receiveResult in
        guard case .success(let msg) = receiveResult,
              case .string(let text) = msg,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            completion(["error": "core_unreachable"])
            return
        }

        let msgType = json["type"] as? String
        let msgId = json["id"] as? String

        // Skip event messages (e.g., pattern_cache_sync sent after handshake)
        if msgType == "event" {
            receiveResponse(wsTask: wsTask, expectedId: expectedId, attemptsLeft: attemptsLeft - 1, completion: completion)
            return
        }

        // Check if this is our response
        if msgType == "response" && msgId == expectedId {
            completion(json)
            return
        }

        // Not our message, try again
        receiveResponse(wsTask: wsTask, expectedId: expectedId, attemptsLeft: attemptsLeft - 1, completion: completion)
    }
}

// MARK: - Main

func nmhMain() {
    guard let messageData = readMessage(),
          let json = try? JSONSerialization.jsonObject(with: messageData) as? [String: Any],
          let action = json["action"] as? String else {
        writeError("invalid_request")
        return
    }

    // get_config: read ipc.json directly (no WS needed)
    if action == "get_config" {
        guard let config = loadIPCConfig() else {
            writeError("ipc_not_found", message: "ipc.json not found or unreadable")
            return
        }
        writeJSON(["port": config.port, "token": config.token])
        return
    }

    // Relay actions: connect to Core WS, forward request, return response
    if relayActions.contains(action) {
        guard let config = loadIPCConfig() else {
            writeError("ipc_not_found", message: "ipc.json not found or unreadable")
            return
        }

        let payload = json["payload"] as? [String: Any] ?? [:]
        let response = relayToCore(config: config, action: action, payload: payload)
        writeJSON(response)
        return
    }

    writeError("unknown_action", message: "Unknown action: \(action)")
}

nmhMain()
