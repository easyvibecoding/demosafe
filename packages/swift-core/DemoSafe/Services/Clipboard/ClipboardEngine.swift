import Foundation
import AppKit

/// Manages all clipboard operations. The ONLY path for plaintext to leave Keychain.
///
/// Security flow: Keychain → ClipboardEngine → NSPasteboard
/// Plaintext variable is zeroed immediately after write.
final class ClipboardEngine {
    private let keychainService: KeychainService
    private let maskingCoordinator: MaskingCoordinator?
    private var autoClearTimer: Timer?
    private var lastCopiedKeyId: UUID?

    init(keychainService: KeychainService, maskingCoordinator: MaskingCoordinator? = nil) {
        self.keychainService = keychainService
        self.maskingCoordinator = maskingCoordinator
    }

    // MARK: - Public API

    /// Copy key plaintext to NSPasteboard. This is the ONLY plaintext output path.
    ///
    /// Flow:
    /// 1. Retrieve plaintext from Keychain
    /// 2. Write to NSPasteboard
    /// 3. Zero-fill the plaintext variable
    /// 4. Schedule auto-clear if configured
    ///
    /// - Parameter keyId: The key to copy
    /// - Parameter autoClearSeconds: Optional auto-clear delay. If nil, no auto-clear.
    /// - Throws: KeychainService.KeychainError if retrieval fails
    func copyToClipboard(keyId: UUID, autoClearSeconds: Int? = nil) throws {
        // Skip redundant copy of same key (just reset timer)
        if keyId == lastCopiedKeyId {
            if let seconds = autoClearSeconds {
                startAutoClear(seconds: seconds)
            }
            return
        }

        // 1. Retrieve plaintext from Keychain
        var plaintext = try keychainService.retrieveKey(keyId: keyId)

        defer {
            // 3. Zero-fill plaintext — critical security step
            plaintext.resetBytes(in: 0..<plaintext.count)
        }

        // 2. Write to NSPasteboard
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()

        guard let string = String(data: plaintext, encoding: .utf8) else {
            throw ClipboardError.encodingFailed
        }

        guard pasteboard.setString(string, forType: .string) else {
            throw ClipboardError.pasteboardWriteFailed
        }

        lastCopiedKeyId = keyId

        // 4. Schedule auto-clear if configured
        if let seconds = autoClearSeconds {
            startAutoClear(seconds: seconds)
        }
    }

    /// Immediately clear the clipboard.
    func clearClipboard() {
        NSPasteboard.general.clearContents()
        autoClearTimer?.invalidate()
        autoClearTimer = nil
        lastCopiedKeyId = nil
    }

    /// Schedule automatic clipboard clearing after specified seconds.
    /// Calling again resets the timer.
    func startAutoClear(seconds: Int) {
        autoClearTimer?.invalidate()
        autoClearTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(seconds), repeats: false) { [weak self] _ in
            self?.clearClipboard()
            NotificationCenter.default.post(
                name: Notification.Name("ClipboardEngine.clipboardCleared"),
                object: self
            )
        }
    }

    /// Scan current clipboard content for API key patterns.
    /// Uses MaskingCoordinator's compiled patterns for detection.
    func detectKeysInClipboard() -> [DetectedKey] {
        guard let coordinator = maskingCoordinator else { return [] }
        guard let content = NSPasteboard.general.string(forType: .string) else { return [] }

        let keys = coordinator.patternCacheEntries()
        var detected: [DetectedKey] = []

        for entry in keys {
            guard let regex = try? NSRegularExpression(pattern: entry.pattern) else { continue }
            let nsRange = NSRange(content.startIndex..., in: content)
            let matches = regex.matches(in: content, range: nsRange)

            for match in matches {
                guard let range = Range(match.range, in: content) else { continue }
                let rawValue = String(content[range])
                detected.append(DetectedKey(
                    rawValue: rawValue,
                    suggestedService: entry.serviceName,
                    pattern: entry.pattern,
                    confidence: calculateConfidence(pattern: entry.pattern, match: rawValue)
                ))
            }
        }

        return detected
    }

    /// Check if auto-clear timer is currently active.
    var isAutoClearScheduled: Bool {
        return autoClearTimer?.isValid ?? false
    }

    // MARK: - Errors

    enum ClipboardError: Error, LocalizedError {
        case encodingFailed
        case pasteboardWriteFailed

        var errorDescription: String? {
            switch self {
            case .encodingFailed:
                return "Failed to encode key data as UTF-8 string"
            case .pasteboardWriteFailed:
                return "Failed to write to system clipboard"
            }
        }
    }

    // MARK: - Private

    /// Calculate confidence score based on pattern specificity.
    /// Patterns with fixed prefixes score higher than generic patterns.
    private func calculateConfidence(pattern: String, match: String) -> Double {
        // Patterns with longer static prefixes are more confident
        let metaChars: Set<Character> = ["[", "(", "{", "\\", ".", "*", "+", "?", "^", "$", "|"]
        var staticPrefixLen = 0
        for char in pattern {
            if metaChars.contains(char) { break }
            staticPrefixLen += 1
        }

        // Base confidence: longer static prefix = higher confidence
        let prefixScore = min(Double(staticPrefixLen) / 10.0, 0.5)

        // Length score: longer matches are more likely to be real keys
        let lengthScore = min(Double(match.count) / 60.0, 0.3)

        // Minimum threshold
        let base = 0.2

        return min(base + prefixScore + lengthScore, 1.0)
    }
}
