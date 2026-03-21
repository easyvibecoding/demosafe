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

    /// Well-known API key patterns for clipboard capture detection.
    /// These detect NEW keys not yet in the vault, unlike patternCacheEntries() which only matches stored keys.
    static let builtInCapturePatterns: [(pattern: String, service: String, confidence: Double)] = [
        // OpenAI
        ("sk-proj-[A-Za-z0-9_-]{20,}", "OpenAI", 0.95),
        ("sk-ant-api03-[A-Za-z0-9_-]{20,}", "Anthropic", 0.95),
        ("sk-ant-[A-Za-z0-9_-]{20,}", "Anthropic", 0.90),
        // GitHub
        ("ghp_[A-Za-z0-9]{36,}", "GitHub", 0.95),
        ("gho_[A-Za-z0-9]{36,}", "GitHub", 0.95),
        ("ghu_[A-Za-z0-9]{36,}", "GitHub", 0.95),
        ("ghs_[A-Za-z0-9]{36,}", "GitHub", 0.95),
        ("ghr_[A-Za-z0-9]{36,}", "GitHub", 0.95),
        // GitLab
        ("glpat-[A-Za-z0-9_-]{20,}", "GitLab", 0.90),
        // Google Cloud
        ("AIzaSy[A-Za-z0-9_-]{33}", "Google Cloud", 0.90),
        // AWS
        ("AKIA[A-Z0-9]{16}", "AWS", 0.90),
        ("ASIA[A-Z0-9]{16}", "AWS", 0.85),
        // Slack
        ("xoxb-[A-Za-z0-9-]{20,}", "Slack", 0.90),
        ("xoxp-[A-Za-z0-9-]{20,}", "Slack", 0.90),
        // HuggingFace
        ("hf_[A-Za-z0-9]{20,}", "HuggingFace", 0.90),
        // Stripe
        ("sk_live_[A-Za-z0-9]{20,}", "Stripe", 0.90),
        ("sk_test_[A-Za-z0-9]{20,}", "Stripe", 0.85),
        ("pk_live_[A-Za-z0-9]{20,}", "Stripe", 0.85),
        ("pk_test_[A-Za-z0-9]{20,}", "Stripe", 0.80),
        // SendGrid
        ("SG\\.[A-Za-z0-9_-]{20,}", "SendGrid", 0.85),
        // Generic (lower confidence)
        ("sk-[A-Za-z0-9_-]{30,}", "Unknown API", 0.60),
    ]

    /// Scan current clipboard content for API key patterns.
    /// Uses both built-in capture patterns (for detecting NEW keys) and
    /// MaskingCoordinator's cached patterns (for detecting stored keys).
    func detectKeysInClipboard() -> [DetectedKey] {
        guard let rawContent = NSPasteboard.general.string(forType: .string) else { return [] }
        // Strip all whitespace and newlines — API keys never contain spaces,
        // but clipboard content may have line breaks from word-wrap or copy artifacts
        let content = rawContent.components(separatedBy: .whitespacesAndNewlines).joined()

        var detected: [DetectedKey] = []
        var matchedRanges: [Range<String.Index>] = []

        // Phase 1: Built-in capture patterns (detect new keys)
        for entry in Self.builtInCapturePatterns {
            guard let regex = try? NSRegularExpression(pattern: entry.pattern) else { continue }
            let nsRange = NSRange(content.startIndex..., in: content)
            let matches = regex.matches(in: content, range: nsRange)

            for match in matches {
                guard let range = Range(match.range, in: content) else { continue }
                // Skip overlapping matches
                if matchedRanges.contains(where: { $0.overlaps(range) }) { continue }
                matchedRanges.append(range)

                let rawValue = String(content[range])
                detected.append(DetectedKey(
                    rawValue: rawValue,
                    suggestedService: entry.service,
                    pattern: entry.pattern,
                    confidence: entry.confidence
                ))
            }
        }

        // Phase 2: Vault pattern cache (detect stored keys already known)
        if let coordinator = maskingCoordinator {
            for entry in coordinator.patternCacheEntries() {
                guard let regex = try? NSRegularExpression(pattern: entry.pattern) else { continue }
                let nsRange = NSRange(content.startIndex..., in: content)
                let matches = regex.matches(in: content, range: nsRange)

                for match in matches {
                    guard let range = Range(match.range, in: content) else { continue }
                    if matchedRanges.contains(where: { $0.overlaps(range) }) { continue }
                    matchedRanges.append(range)

                    let rawValue = String(content[range])
                    detected.append(DetectedKey(
                        rawValue: rawValue,
                        suggestedService: entry.serviceName,
                        pattern: entry.pattern,
                        confidence: calculateConfidence(pattern: entry.pattern, match: rawValue)
                    ))
                }
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
