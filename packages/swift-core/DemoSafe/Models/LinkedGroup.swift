import Foundation

/// An ordered group of keys for batch paste operations.
struct LinkedGroup: Codable, Identifiable {
    let id: UUID
    var label: String
    var keyIds: [UUID]
    var pasteMode: PasteMode
    var createdAt: Date
}

enum PasteMode: String, Codable {
    case selectField    // MVP: user selects which field to paste
    case sequential     // Future: paste keys in order
}
