import Foundation

/// Root structure for vault.json persistence.
struct Vault: Codable {
    var services: [Service]
    var keys: [KeyEntry]
    var linkedGroups: [LinkedGroup]
    var contextModes: [ContextMode]
    var patternCacheVersion: Int
}
