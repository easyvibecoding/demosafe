import Foundation

/// Result of pattern matching against text content.
struct MaskResult {
    let keyId: UUID
    let matchedRange: Range<String.Index>
    let maskedText: String
    let pattern: String
    let serviceId: UUID
}
