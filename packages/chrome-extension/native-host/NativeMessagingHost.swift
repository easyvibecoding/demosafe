import Foundation

/// Native Messaging Host for Chrome Extension.
/// Reads ~/.demosafe/ipc.json and returns {port, token} to the extension.
/// Protocol: Chrome Native Messaging (stdin/stdout with 4-byte length prefix).

struct IPCConfig: Codable {
    let port: Int
    let pid: Int
    let version: String
    let token: String
}

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
    data.withUnsafeBytes { fwrite($0.baseAddress, 1, data.count, stdout) }
    fflush(stdout)
}

func main() {
    guard readMessage() != nil else { return }

    let configPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".demosafe/ipc.json")

    guard let configData = try? Data(contentsOf: configPath),
          let config = try? JSONDecoder().decode(IPCConfig.self, from: configData) else {
        let error = try! JSONSerialization.data(withJSONObject: ["error": "ipc.json not found"])
        writeMessage(error)
        return
    }

    let response: [String: Any] = ["port": config.port, "token": config.token]
    let responseData = try! JSONSerialization.data(withJSONObject: response)
    writeMessage(responseData)
}

main()
