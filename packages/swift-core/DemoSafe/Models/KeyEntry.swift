import Foundation
import CryptoKit

/// A single API key entry stored in the vault.
struct KeyEntry: Codable, Identifiable {
    let id: UUID
    var label: String
    var serviceId: UUID
    var pattern: String
    var maskFormat: MaskFormat
    var keychainId: String  // Reference to Keychain item: "com.demosafe.key.{id}"
    var createdAt: Date
    var updatedAt: Date
    var linkedGroupId: UUID?
    var sortOrder: Int?
    var valueHash: String?  // SHA-256 hash for dedup without Keychain access

    /// Compute SHA-256 hash of key value data.
    static func computeHash(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
