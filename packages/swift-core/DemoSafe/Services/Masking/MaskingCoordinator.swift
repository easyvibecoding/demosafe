import Foundation
import Combine

/// Central masking state hub. Publishes isDemoMode and activeContext for SwiftUI binding.
/// All pattern matching is centralized here. Extensions subscribe via IPC.
final class MaskingCoordinator: ObservableObject {
    @Published var isDemoMode: Bool = false
    @Published var activeContext: ContextMode?

    private let vaultManager: VaultManager
    private var compiledPatterns: [CompiledPattern] = []
    private var cancellables = Set<AnyCancellable>()

    struct CompiledPattern {
        let keyId: UUID
        let serviceId: UUID
        let regex: NSRegularExpression
        let pattern: String
        let maskFormat: MaskFormat
        let maskedPreview: String
    }

    init(vaultManager: VaultManager) {
        self.vaultManager = vaultManager
        recompilePatterns()
        activeContext = vaultManager.activeContext()

        // Listen for vault changes to recompile patterns
        NotificationCenter.default.publisher(for: VaultManager.vaultDidChangeNotification)
            .sink { [weak self] _ in
                self?.recompilePatterns()
                self?.activeContext = self?.vaultManager.activeContext()
            }
            .store(in: &cancellables)
    }

    // MARK: - Public API

    /// Scan text for all matching patterns. Returns matches sorted by position.
    /// Respects activeContext.activeServiceIds filtering.
    func shouldMask(text: String) -> [MaskResult] {
        guard isDemoMode else { return [] }
        guard let context = activeContext, context.maskingLevel != .off else { return [] }

        let patterns = activePatterns()
        var allMatches: [MaskResult] = []

        for compiled in patterns {
            let nsRange = NSRange(text.startIndex..., in: text)
            let matches = compiled.regex.matches(in: text, range: nsRange)

            for match in matches {
                guard let range = Range(match.range, in: text) else { continue }
                let matchedText = String(text[range])
                let masked = applyMask(matchedText, format: compiled.maskFormat)

                allMatches.append(MaskResult(
                    keyId: compiled.keyId,
                    matchedRange: range,
                    maskedText: masked,
                    pattern: compiled.pattern,
                    serviceId: compiled.serviceId
                ))
            }
        }

        // Sort by position, then resolve overlaps (longest match wins)
        allMatches.sort { $0.matchedRange.lowerBound < $1.matchedRange.lowerBound }
        return resolveOverlaps(allMatches)
    }

    /// Return masked display string for a specific key.
    func maskedDisplay(keyId: UUID) -> String {
        guard let key = vaultManager.getKey(keyId: keyId) else { return "****" }

        // We don't have the plaintext — generate preview from pattern info
        if let compiled = compiledPatterns.first(where: { $0.keyId == keyId }) {
            return compiled.maskedPreview
        }

        return applyMask("", format: key.maskFormat)
    }

    /// Get all pattern cache entries for IPC sync (no plaintext).
    func patternCacheEntries() -> [PatternCacheEntry] {
        return compiledPatterns.map { compiled in
            let service = vaultManager.getService(serviceId: compiled.serviceId)
            return PatternCacheEntry(
                keyId: compiled.keyId,
                serviceId: compiled.serviceId,
                serviceName: service?.name ?? "Unknown",
                pattern: compiled.pattern,
                maskFormat: compiled.maskFormat,
                maskedPreview: compiled.maskedPreview
            )
        }
    }

    /// Current pattern cache version from vault.
    var patternCacheVersion: Int {
        return vaultManager.vault.patternCacheVersion
    }

    /// Broadcast current state to all connected extensions via IPC.
    func broadcastState() {
        // Will be called by IPCServer when connected
        NotificationCenter.default.post(
            name: Notification.Name("MaskingCoordinator.stateDidChange"),
            object: self
        )
    }

    // MARK: - Private

    /// Recompile all patterns from vault keys. Called on init and vault changes.
    private func recompilePatterns() {
        let keys = vaultManager.getAllKeys()
        compiledPatterns = keys.compactMap { key in
            guard let regex = try? NSRegularExpression(pattern: key.pattern) else { return nil }
            let service = vaultManager.getService(serviceId: key.serviceId)
            let preview = generateMaskedPreview(
                serviceName: service?.name ?? "",
                pattern: key.pattern,
                format: key.maskFormat
            )
            return CompiledPattern(
                keyId: key.id,
                serviceId: key.serviceId,
                regex: regex,
                pattern: key.pattern,
                maskFormat: key.maskFormat,
                maskedPreview: preview
            )
        }

        // Sort by pattern length descending (more specific patterns first)
        compiledPatterns.sort { $0.pattern.count > $1.pattern.count }
    }

    /// Return only patterns whose serviceId is in the active context's allowed list.
    private func activePatterns() -> [CompiledPattern] {
        guard let serviceIds = activeContext?.activeServiceIds else {
            // nil = all services active
            return compiledPatterns
        }
        let allowed = Set(serviceIds)
        return compiledPatterns.filter { allowed.contains($0.serviceId) }
    }

    /// Apply mask format to a matched string.
    func applyMask(_ text: String, format: MaskFormat) -> String {
        let chars = Array(text)
        let total = chars.count

        let prefixCount = min(format.showPrefix, total)
        let suffixCount = min(format.showSuffix, max(0, total - prefixCount))

        let prefix = prefixCount > 0 ? String(chars[..<prefixCount]) : ""
        let suffix = suffixCount > 0 ? String(chars[(total - suffixCount)...]) : ""
        let mask = String(repeating: format.maskChar, count: 4)

        if prefix.isEmpty && suffix.isEmpty {
            return "\(mask)\(format.separator)\(mask)"
        } else if suffix.isEmpty {
            return "\(prefix)\(mask)\(format.separator)\(mask)"
        } else if prefix.isEmpty {
            return "\(mask)\(format.separator)\(mask)\(suffix)"
        } else {
            return "\(prefix)\(mask)\(format.separator)\(mask)\(suffix)"
        }
    }

    /// Generate a masked preview string from service pattern info.
    private func generateMaskedPreview(serviceName: String, pattern: String, format: MaskFormat) -> String {
        // Extract static prefix from pattern (e.g., "sk-proj-" from "sk-proj-[A-Za-z0-9_-]{20,}")
        let staticPrefix = extractStaticPrefix(from: pattern)
        let mask = String(repeating: format.maskChar, count: 4)

        if format.showPrefix > 0 && !staticPrefix.isEmpty {
            let visiblePrefix = String(staticPrefix.prefix(format.showPrefix))
            return "\(visiblePrefix)\(mask)\(format.separator)\(mask)"
        }

        if format.showSuffix > 0 {
            return "\(mask)\(format.separator)\(mask)" + String(repeating: format.maskChar, count: format.showSuffix)
        }

        return "\(mask)\(format.separator)\(mask)"
    }

    /// Extract literal prefix from a regex pattern (characters before first metachar).
    private func extractStaticPrefix(from pattern: String) -> String {
        let metaChars: Set<Character> = ["[", "(", "{", "\\", ".", "*", "+", "?", "^", "$", "|"]
        var prefix = ""
        for char in pattern {
            if metaChars.contains(char) { break }
            prefix.append(char)
        }
        return prefix
    }

    /// Remove overlapping matches, keeping the longest match at each position.
    private func resolveOverlaps(_ matches: [MaskResult]) -> [MaskResult] {
        guard !matches.isEmpty else { return [] }

        var resolved: [MaskResult] = []
        var lastEnd: String.Index?

        for match in matches {
            if let end = lastEnd, match.matchedRange.lowerBound < end {
                // Overlap: keep whichever is longer
                if let last = resolved.last {
                    if match.maskedText.count > last.maskedText.count {
                        resolved[resolved.count - 1] = match
                        lastEnd = match.matchedRange.upperBound
                    }
                }
            } else {
                resolved.append(match)
                lastEnd = match.matchedRange.upperBound
            }
        }

        return resolved
    }
}
