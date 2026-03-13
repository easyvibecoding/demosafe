import Foundation
import CoreGraphics
import Carbon.HIToolbox

/// Global hotkey manager using CGEvent.tapCreate for system-level interception.
///
/// Registered shortcuts:
/// - ⌃⌥Space: Toggle floating toolbox
/// - ⌃⌥⌘D: Toggle demo mode
/// - ⌃⌥[1-9]: Paste key by index
/// - ⌃⌥⌘V: Capture clipboard
final class HotkeyManager {
    private let maskingCoordinator: MaskingCoordinator
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    /// Callback closures set by the app to handle hotkey actions.
    var onToggleToolbox: (() -> Void)?
    var onToggleDemoMode: (() -> Void)?
    var onPasteKeyByIndex: ((Int) -> Void)?
    var onCaptureClipboard: (() -> Void)?

    init(maskingCoordinator: MaskingCoordinator) {
        self.maskingCoordinator = maskingCoordinator
    }

    // MARK: - Public API

    /// Start listening for global hotkeys. Requires Accessibility permission.
    /// Returns false if the event tap could not be created (permission denied).
    @discardableResult
    func start() -> Bool {
        guard eventTap == nil else { return true }

        let eventMask: CGEventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)

        // Store weak self in a context for the C callback
        let selfPointer = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(refcon).takeUnretainedValue()
                return manager.handleEvent(proxy: proxy, type: type, event: event)
            },
            userInfo: selfPointer
        ) else {
            return false
        }

        eventTap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)

        if let source = runLoopSource {
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        }

        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    /// Stop listening for global hotkeys.
    func stop() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            if let source = runLoopSource {
                CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            }
            eventTap = nil
            runLoopSource = nil
        }
    }

    /// Check if Accessibility permission is granted.
    static var hasAccessibilityPermission: Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Prompt user for Accessibility permission.
    static func requestAccessibilityPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
        AXIsProcessTrustedWithOptions(options)
    }

    // MARK: - Private

    private func handleEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        // Re-enable tap if disabled by system timeout
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap = eventTap {
                CGEvent.tapEnable(tap: tap, enable: true)
            }
            return Unmanaged.passUnretained(event)
        }

        guard type == .keyDown else {
            return Unmanaged.passUnretained(event)
        }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags

        let hasControl = flags.contains(.maskControl)
        let hasOption = flags.contains(.maskAlternate)
        let hasCommand = flags.contains(.maskCommand)

        // ⌃⌥Space — Toggle toolbox
        if hasControl && hasOption && !hasCommand && keyCode == kVK_Space {
            DispatchQueue.main.async { self.onToggleToolbox?() }
            return nil // Consume event
        }

        // ⌃⌥⌘D — Toggle demo mode
        if hasControl && hasOption && hasCommand && keyCode == kVK_ANSI_D {
            DispatchQueue.main.async { self.onToggleDemoMode?() }
            return nil
        }

        // ⌃⌥⌘V — Capture clipboard
        if hasControl && hasOption && hasCommand && keyCode == kVK_ANSI_V {
            DispatchQueue.main.async { self.onCaptureClipboard?() }
            return nil
        }

        // ⌃⌥[1-9] — Paste key by index
        if hasControl && hasOption && !hasCommand {
            let numberKeyRange: [Int] = [
                kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3,
                kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6,
                kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9,
            ]
            if let index = numberKeyRange.firstIndex(where: { $0 == keyCode }) {
                let keyIndex = index + 1 // 1-based
                DispatchQueue.main.async { self.onPasteKeyByIndex?(keyIndex) }
                return nil
            }
        }

        // Not our hotkey, pass through
        return Unmanaged.passUnretained(event)
    }
}
