import Foundation

/// A key detected via pattern matching in clipboard or text content.
struct DetectedKey {
    let rawValue: String
    let suggestedService: String?
    let pattern: String
    let confidence: Double  // 0.0 - 1.0
}
