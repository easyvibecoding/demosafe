import Foundation
import CoreGraphics
import Carbon.HIToolbox

/// Global hotkey manager using CGEvent.tapCreate for system-level interception.
///
/// Registered shortcuts:
/// - ⌃⌥Space (hold): Show floating toolbox with search
/// - ⌃⌥⌘D: Toggle demo mode
/// - ⌃⌥[1-9]: Paste key by index
/// - ⌃⌥⌘V: Capture clipboard
final class HotkeyManager {
    private let maskingCoordinator: MaskingCoordinator
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    // Hold detection state
    private var isToolboxHoldActive = false

    /// Toolbox callbacks (hold-to-search model)
    var onToolboxShow: (() -> Void)?
    var onToolboxRelease: (() -> Void)?
    var onToolboxKeystroke: ((String) -> Void)?

    /// Locked mode callbacks
    var onToolboxArrow: ((Int) -> Void)?   // delta: -1 (up) or +1 (down)
    var onToolboxConfirm: (() -> Void)?    // Enter
    var onToolboxDismiss: (() -> Void)?    // Esc

    /// Other hotkey callbacks
    var onToggleDemoMode: (() -> Void)?
    var onPasteKeyByIndex: ((Int) -> Void)?
    var onCaptureClipboard: (() -> Void)?

    /// Whether toolbox is in locked mode (set by AppState)
    var isToolboxLocked = false

    init(maskingCoordinator: MaskingCoordinator) {
        self.maskingCoordinator = maskingCoordinator
    }

    // MARK: - Public API

    @discardableResult
    func start() -> Bool {
        guard eventTap == nil else { return true }

        let eventMask: CGEventMask =
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.keyUp.rawValue) |
            (1 << CGEventType.flagsChanged.rawValue)

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

    static var hasAccessibilityPermission: Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

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

        // Modifier flags changed — detect ⌃/⌥ release during hold
        if type == .flagsChanged {
            return handleFlagsChanged(event: event)
        }

        // Key up — detect Space release during hold
        if type == .keyUp {
            return handleKeyUp(event: event)
        }

        // Key down
        return handleKeyDown(event: event)
    }

    // MARK: - Key Down

    private func handleKeyDown(event: CGEvent) -> Unmanaged<CGEvent>? {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags

        let hasControl = flags.contains(.maskControl)
        let hasOption = flags.contains(.maskAlternate)
        let hasCommand = flags.contains(.maskCommand)

        // ⌃⌥Space — Start toolbox hold
        if hasControl && hasOption && !hasCommand && keyCode == kVK_Space {
            if !isToolboxHoldActive {
                isToolboxHoldActive = true
                DispatchQueue.main.async { self.onToolboxShow?() }
            }
            return nil // Consume
        }

        // While toolbox hold is active — forward keystrokes
        if isToolboxHoldActive {
            return handleToolboxKeystroke(keyCode: Int(keyCode), event: event)
        }

        // While toolbox is locked — handle navigation
        if isToolboxLocked {
            return handleLockedKeystroke(keyCode: Int(keyCode))
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
            let numberKeyCodes: [Int] = [
                kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3,
                kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6,
                kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9,
            ]
            if let index = numberKeyCodes.firstIndex(where: { $0 == keyCode }) {
                let keyIndex = index + 1
                DispatchQueue.main.async { self.onPasteKeyByIndex?(keyIndex) }
                return nil
            }
        }

        return Unmanaged.passUnretained(event)
    }

    // MARK: - Key Up

    private func handleKeyUp(event: CGEvent) -> Unmanaged<CGEvent>? {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

        // Space released during hold → trigger release
        if isToolboxHoldActive && keyCode == kVK_Space {
            isToolboxHoldActive = false
            DispatchQueue.main.async { self.onToolboxRelease?() }
            return nil
        }

        return Unmanaged.passUnretained(event)
    }

    // MARK: - Flags Changed

    private func handleFlagsChanged(event: CGEvent) -> Unmanaged<CGEvent>? {
        guard isToolboxHoldActive else {
            return Unmanaged.passUnretained(event)
        }

        let flags = event.flags
        // If Control or Option released during hold → trigger release
        if !flags.contains(.maskControl) || !flags.contains(.maskAlternate) {
            isToolboxHoldActive = false
            DispatchQueue.main.async { self.onToolboxRelease?() }
            return nil
        }

        return Unmanaged.passUnretained(event)
    }

    // MARK: - Toolbox Keystroke Forwarding

    private func handleToolboxKeystroke(keyCode: Int, event: CGEvent) -> Unmanaged<CGEvent>? {
        // Backspace
        if keyCode == kVK_Delete {
            DispatchQueue.main.async { self.onToolboxKeystroke?("\u{7f}") }
            return nil
        }

        // Escape — dismiss during hold
        if keyCode == kVK_Escape {
            isToolboxHoldActive = false
            DispatchQueue.main.async { self.onToolboxDismiss?() }
            return nil
        }

        // Convert key code to character
        if let char = Self.keyCodeToCharacter(keyCode) {
            DispatchQueue.main.async { self.onToolboxKeystroke?(char) }
            return nil
        }

        return Unmanaged.passUnretained(event)
    }

    // MARK: - Locked Mode Keystroke

    private func handleLockedKeystroke(keyCode: Int) -> Unmanaged<CGEvent>? {
        switch keyCode {
        case kVK_UpArrow:
            DispatchQueue.main.async { self.onToolboxArrow?(-1) }
            return nil
        case kVK_DownArrow:
            DispatchQueue.main.async { self.onToolboxArrow?(1) }
            return nil
        case kVK_Return:
            DispatchQueue.main.async { self.onToolboxConfirm?() }
            return nil
        case kVK_Escape:
            DispatchQueue.main.async { self.onToolboxDismiss?() }
            return nil
        default:
            return nil // Consume all keystrokes in locked mode
        }
    }

    // MARK: - Key Code Mapping (US layout)

    private static func keyCodeToCharacter(_ keyCode: Int) -> String? {
        let map: [Int: String] = [
            kVK_ANSI_A: "a", kVK_ANSI_B: "b", kVK_ANSI_C: "c", kVK_ANSI_D: "d",
            kVK_ANSI_E: "e", kVK_ANSI_F: "f", kVK_ANSI_G: "g", kVK_ANSI_H: "h",
            kVK_ANSI_I: "i", kVK_ANSI_J: "j", kVK_ANSI_K: "k", kVK_ANSI_L: "l",
            kVK_ANSI_M: "m", kVK_ANSI_N: "n", kVK_ANSI_O: "o", kVK_ANSI_P: "p",
            kVK_ANSI_Q: "q", kVK_ANSI_R: "r", kVK_ANSI_S: "s", kVK_ANSI_T: "t",
            kVK_ANSI_U: "u", kVK_ANSI_V: "v", kVK_ANSI_W: "w", kVK_ANSI_X: "x",
            kVK_ANSI_Y: "y", kVK_ANSI_Z: "z",
            kVK_ANSI_0: "0", kVK_ANSI_1: "1", kVK_ANSI_2: "2", kVK_ANSI_3: "3",
            kVK_ANSI_4: "4", kVK_ANSI_5: "5", kVK_ANSI_6: "6", kVK_ANSI_7: "7",
            kVK_ANSI_8: "8", kVK_ANSI_9: "9",
            kVK_ANSI_Minus: "-", kVK_ANSI_Period: ".", kVK_ANSI_Slash: "/",
            kVK_Space: " ",
        ]
        return map[keyCode]
    }
}
