import Foundation

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
}
