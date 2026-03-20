import Foundation
import AppKit
import CoreGraphics
import Carbon.HIToolbox
import os

private let logger = Logger(subsystem: "com.demosafe", category: "SequentialPasteEngine")

/// Orchestrates pasting multiple keys from a LinkedGroup.
///
/// Sequential mode: copy each key to clipboard → simulate ⌘V → simulate Tab → repeat.
/// SelectField mode: copy a single specified field to clipboard.
final class SequentialPasteEngine {
    private let clipboardEngine: ClipboardEngine
    private let keychainService: KeychainService

    enum PasteError: Error, LocalizedError {
        case fieldIndexOutOfRange(Int, count: Int)
        case emptyGroup
        case keychainRetrieveFailed(UUID)

        var errorDescription: String? {
            switch self {
            case .fieldIndexOutOfRange(let idx, let count):
                return "Field index \(idx) out of range (group has \(count) entries)"
            case .emptyGroup:
                return "LinkedGroup has no entries"
            case .keychainRetrieveFailed(let id):
                return "Failed to retrieve key from Keychain: \(id)"
            }
        }
    }

    init(clipboardEngine: ClipboardEngine, keychainService: KeychainService) {
        self.clipboardEngine = clipboardEngine
        self.keychainService = keychainService
    }

    // MARK: - Public API

    /// Paste all keys in the group sequentially: ⌘V → Tab → ⌘V → Tab → ...
    ///
    /// Pre-fetches ALL key values from Keychain upfront so that any confirmation
    /// dialogs appear before the paste sequence begins. This prevents Keychain
    /// prompts from interrupting the Tab → Paste flow.
    func pasteGroupSequentially(_ group: LinkedGroup, autoClearSeconds: Int?) async throws {
        let sorted = group.entries.sorted { $0.sortOrder < $1.sortOrder }
        guard !sorted.isEmpty else { throw PasteError.emptyGroup }

        logger.info("Sequential paste: group=\(group.label) entries=\(sorted.count)")

        // Phase 1: Pre-fetch all key values from Keychain (may trigger auth dialogs)
        var prefetched: [(entry: GroupEntry, value: String)] = []
        for entry in sorted {
            var plaintext = try keychainService.retrieveKey(keyId: entry.keyId)
            defer { plaintext.resetBytes(in: 0..<plaintext.count) }

            guard let value = String(data: plaintext, encoding: .utf8) else {
                throw PasteError.keychainRetrieveFailed(entry.keyId)
            }
            prefetched.append((entry: entry, value: value))
        }

        logger.info("All keys pre-fetched, starting paste sequence")

        // Phase 2: Paste sequence (no more Keychain access needed)
        for (i, item) in prefetched.enumerated() {
            // Write to clipboard directly
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(item.value, forType: .string)

            // Small delay to ensure clipboard is ready
            try await Task.sleep(for: .milliseconds(80))

            // Simulate ⌘V to paste
            simulatePaste()

            // Between entries: wait for paste to complete, then Tab to next field
            if i < prefetched.count - 1 {
                try await Task.sleep(for: .milliseconds(250))
                simulateTab()
                try await Task.sleep(for: .milliseconds(200))
            }
        }

        // Schedule auto-clear after last key
        if let seconds = autoClearSeconds {
            clipboardEngine.startAutoClear(seconds: seconds)
        }

        logger.info("Sequential paste complete")
    }

    /// Copy a single field from the group to clipboard (selectField mode).
    func pasteField(_ group: LinkedGroup, fieldIndex: Int, autoClearSeconds: Int?) throws {
        let sorted = group.entries.sorted { $0.sortOrder < $1.sortOrder }
        guard fieldIndex >= 0, fieldIndex < sorted.count else {
            throw PasteError.fieldIndexOutOfRange(fieldIndex, count: sorted.count)
        }

        let entry = sorted[fieldIndex]
        logger.info("Field paste: group=\(group.label) field=\(entry.fieldLabel) index=\(fieldIndex)")
        try clipboardEngine.copyToClipboard(keyId: entry.keyId, autoClearSeconds: autoClearSeconds)
    }

    // MARK: - Private — Key Simulation

    /// Simulate ⌘V (Paste) keystroke via CGEvent.
    /// Uses a dedicated event source to isolate modifier state.
    private func simulatePaste() {
        let keyCode = CGKeyCode(kVK_ANSI_V)
        let source = CGEventSource(stateID: .combinedSessionState)

        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
            logger.error("Failed to create CGEvent for ⌘V")
            return
        }

        keyDown.flags = .maskCommand
        keyUp.flags = []  // Explicitly release Command on keyUp

        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    /// Simulate Tab keystroke via CGEvent.
    /// Explicitly clears all modifier flags to prevent ⌘Tab (app switch).
    private func simulateTab() {
        let keyCode = CGKeyCode(kVK_Tab)
        let source = CGEventSource(stateID: .combinedSessionState)

        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
            logger.error("Failed to create CGEvent for Tab")
            return
        }

        // Clear ALL modifiers — critical to avoid ⌘Tab triggering app switcher
        keyDown.flags = []
        keyUp.flags = []

        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }
}
