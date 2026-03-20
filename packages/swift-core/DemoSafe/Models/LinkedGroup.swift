import Foundation

/// A single entry within a LinkedGroup, representing one key with its field label.
struct GroupEntry: Codable {
    let keyId: UUID
    var fieldLabel: String  // e.g. "Access Key ID", "Secret Key"
    var sortOrder: Int
}

/// An ordered group of keys for batch paste operations.
struct LinkedGroup: Codable, Identifiable {
    let id: UUID
    var label: String
    var entries: [GroupEntry]
    var pasteMode: PasteMode
    var createdAt: Date

    /// Key IDs in sort order, for convenience.
    var sortedKeyIds: [UUID] {
        entries.sorted { $0.sortOrder < $1.sortOrder }.map(\.keyId)
    }
}

enum PasteMode: String, Codable {
    case selectField    // User selects which field to paste
    case sequential     // Paste keys in order with Tab between fields
}
