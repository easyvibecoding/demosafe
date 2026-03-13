import Foundation

/// A service provider (e.g. OpenAI, AWS, Stripe).
struct Service: Codable, Identifiable {
    let id: UUID
    var name: String
    var icon: String?
    var defaultPattern: String
    var defaultMaskFormat: MaskFormat
    var isBuiltIn: Bool
}
