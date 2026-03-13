import Foundation

/// Defines masking behavior for different demo scenarios.
struct ContextMode: Codable, Identifiable {
    let id: UUID
    var name: String
    var maskingLevel: MaskingLevel
    var clipboardClearSeconds: Int?
    var activeServiceIds: [UUID]?
    var isActive: Bool

    enum MaskingLevel: String, Codable {
        case full       // All characters masked
        case partial    // Show prefix + suffix, mask middle
        case off        // No masking (dev mode)
    }
}
