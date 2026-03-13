import Foundation

/// Defines how a key's masked display should be rendered.
struct MaskFormat: Codable {
    var showPrefix: Int
    var showSuffix: Int
    var maskChar: String
    var separator: String

    static let `default` = MaskFormat(showPrefix: 4, showSuffix: 0, maskChar: "*", separator: "...")
}
