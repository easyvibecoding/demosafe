import Foundation
import AppKit
import os

private let logger = Logger(subsystem: "com.demosafe", category: "SystemMasking")

/// System-wide API key masking using macOS Accessibility API.
///
/// Monitors the focused UI element across all applications. When text containing
/// an API key is detected, creates a floating overlay panel to visually mask it.
///
/// Requires Accessibility permission (same as HotkeyManager).
final class SystemMaskingService {
    private let maskingCoordinator: MaskingCoordinator
    private let overlayController: SystemOverlayController

    private var observer: AXObserver?
    private var currentAppPid: pid_t = 0
    private var currentAppElement: AXUIElement?
    private var debounceTimer: Timer?
    private var pollTimer: Timer?
    fileprivate(set) var isRunning = false
    private var lastScannedText: String?

    /// Tracks active overlays for diff/cleanup
    private var activeOverlayIds: Set<UUID> = []

    // Processing takes only 2-6ms, so debounce can be very short
    private static let initialScanDelay: TimeInterval = 0.01  // 10ms for first scan
    private static let debounceInterval: TimeInterval = 0.03  // 30ms for subsequent changes
    private var hasScannedSinceAppSwitch = false

    init(maskingCoordinator: MaskingCoordinator, overlayController: SystemOverlayController) {
        self.maskingCoordinator = maskingCoordinator
        self.overlayController = overlayController
    }

    // MARK: - Public API

    func start() {
        guard !isRunning else { return }
        isRunning = true
        logger.info("System masking started")

        // Listen for app activation changes via NSWorkspace
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(activeAppChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )

        // Scan the currently focused app
        if let frontApp = NSWorkspace.shared.frontmostApplication {
            observeApp(pid: frontApp.processIdentifier)
        }

        // Polling fallback: some apps don't fire AX notifications reliably
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.pollScan()
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        logger.info("System masking stopped")

        NSWorkspace.shared.notificationCenter.removeObserver(self)
        removeCurrentObserver()
        overlayController.removeAllOverlays()
        activeOverlayIds.removeAll()
        debounceTimer?.invalidate()
        debounceTimer = nil
        pollTimer?.invalidate()
        pollTimer = nil
        lastScannedText = nil
    }

    /// Temporarily show/hide overlays (peek mode).
    func setPeekMode(_ enabled: Bool) {
        overlayController.setPeekMode(enabled)
    }

    // MARK: - App Change Handling

    @objc private func activeAppChanged(_ notification: Notification) {
        guard isRunning else { return }
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }

        // Don't observe ourselves
        if app.processIdentifier == ProcessInfo.processInfo.processIdentifier { return }

        logger.info("Active app changed: \(app.localizedName ?? "unknown") (pid \(app.processIdentifier))")

        // Clear overlays from previous app
        overlayController.removeAllOverlays()
        activeOverlayIds.removeAll()
        hasScannedSinceAppSwitch = false
        lastScannedText = nil

        observeApp(pid: app.processIdentifier)

        // Scan IMMEDIATELY on app switch — don't wait for debounce or polling
        scanFocusedElement()
    }

    // MARK: - AXObserver

    private func observeApp(pid: pid_t) {
        removeCurrentObserver()
        currentAppPid = pid
        currentAppElement = AXUIElementCreateApplication(pid)

        var obs: AXObserver?
        let result = AXObserverCreate(pid, systemMaskingCallback, &obs)
        guard result == .success, let obs else {
            logger.warning("Failed to create AXObserver for pid \(pid): \(result.rawValue)")
            return
        }

        observer = obs

        // Listen for focus changes and value changes within this app
        let notifications: [String] = [
            kAXFocusedUIElementChangedNotification,
            kAXValueChangedNotification,
            kAXSelectedTextChangedNotification,
        ]

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        for name in notifications {
            AXObserverAddNotification(obs, currentAppElement!, name as CFString, selfPtr)
        }

        CFRunLoopAddSource(
            CFRunLoopGetMain(),
            AXObserverGetRunLoopSource(obs),
            .defaultMode
        )

        // Initial scan
        scheduleScan()
    }

    private func removeCurrentObserver() {
        if let obs = observer {
            CFRunLoopRemoveSource(
                CFRunLoopGetMain(),
                AXObserverGetRunLoopSource(obs),
                .defaultMode
            )
        }
        observer = nil
        currentAppElement = nil
        currentAppPid = 0
    }

    // MARK: - Scanning

    func handleNotification(_ notification: String) {
        guard isRunning else { return }
        scheduleScan()
    }

    private func scheduleScan() {
        debounceTimer?.invalidate()

        // First scan after app switch: fast (50ms)
        // Subsequent changes: debounce (150ms)
        let delay = hasScannedSinceAppSwitch ? Self.debounceInterval : Self.initialScanDelay

        debounceTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.hasScannedSinceAppSwitch = true
            self?.scanFocusedElement()
        }
    }

    private func scanFocusedElement() {
        guard let appElement = currentAppElement else { return }

        // Get the focused UI element
        var focusedElement: AnyObject?
        let result = AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )

        guard result == .success, let element = focusedElement else { return }

        // AXUIElement is a CFTypeRef — safe cast check
        let axElement = element as! AXUIElement  // Always AXUIElement from CopyAttributeValue

        // Get the text value
        var valueRef: AnyObject?
        let valueResult = AXUIElementCopyAttributeValue(
            axElement,
            kAXValueAttribute as CFString,
            &valueRef
        )

        guard valueResult == .success, let text = valueRef as? String, !text.isEmpty else {
            // No text — clear overlays
            if !activeOverlayIds.isEmpty {
                overlayController.removeAllOverlays()
                activeOverlayIds.removeAll()
            }
            return
        }

        // Skip if text hasn't changed (avoids redundant overlay updates)
        if text == lastScannedText { return }
        lastScannedText = text

        // Run pattern matching
        let matches = maskingCoordinator.shouldMask(text: text)

        if matches.isEmpty {
            if !activeOverlayIds.isEmpty {
                overlayController.removeAllOverlays()
                activeOverlayIds.removeAll()
            }
            return
        }

        // Get element position and size for coordinate calculation
        guard let elementRect = getElementRect(axElement) else { return }

        // Create overlays for each match (use unique ID per occurrence, not per keyId)
        var newActiveIds: Set<UUID> = []

        for (i, match) in matches.enumerated() {
            // Generate a deterministic UUID from keyId + match index to allow diff/reuse
            let overlayId = UUID(
                uuid: withUnsafeBytes(of: match.keyId.uuid) { keyBytes in
                    var bytes = [UInt8](keyBytes)
                    // Mix in the index to make each occurrence unique
                    bytes[14] = UInt8(i & 0xFF)
                    bytes[15] = UInt8((i >> 8) & 0xFF)
                    return (bytes[0], bytes[1], bytes[2], bytes[3],
                            bytes[4], bytes[5], bytes[6], bytes[7],
                            bytes[8], bytes[9], bytes[10], bytes[11],
                            bytes[12], bytes[13], bytes[14], bytes[15])
                }
            )

            let overlayRect = estimateKeyRect(
                element: axElement,
                elementRect: elementRect,
                text: text,
                matchRange: match.matchedRange
            )

            overlayController.showOverlay(
                id: overlayId,
                at: overlayRect,
                maskedText: match.maskedText
            )
            newActiveIds.insert(overlayId)
        }

        // Remove stale overlays
        overlayController.removeStaleOverlays(activeIds: newActiveIds)
        activeOverlayIds = newActiveIds

        logger.info("System masking: \(matches.count) key(s) masked")
    }

    /// Polling fallback — check if text changed and re-scan if needed.
    /// Does NOT clear cache blindly; reads current text first and compares.
    private func pollScan() {
        guard isRunning, let appElement = currentAppElement else { return }

        // Quick check: read focused element's text without full scan
        var focusedElement: AnyObject?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElement) == .success else { return }

        var valueRef: AnyObject?
        guard AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXValueAttribute as CFString, &valueRef) == .success,
              let text = valueRef as? String else { return }

        // Only re-scan if text actually changed
        if text != lastScannedText {
            lastScannedText = nil  // Force rescan
            scanFocusedElement()
        }
    }

    // MARK: - Coordinate Helpers

    private func getElementRect(_ element: AXUIElement) -> CGRect? {
        var positionRef: AnyObject?
        var sizeRef: AnyObject?

        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              positionRef != nil, sizeRef != nil else {
            return nil
        }

        var point = CGPoint.zero
        var size = CGSize.zero

        // AXValue is a CF type — CopyAttributeValue guarantees the correct type
        AXValueGetValue(positionRef as! AXValue, .cgPoint, &point)
        AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)

        return CGRect(origin: point, size: size)
    }

    /// Get the screen rectangle of a matched key within a text element.
    ///
    /// Uses kAXBoundsForRangeParameterizedAttribute for precise multi-line bounds.
    /// Falls back to covering the entire element if the parameterized attribute is unavailable.
    private func estimateKeyRect(element: AXUIElement, elementRect: CGRect, text: String, matchRange: Range<String.Index>) -> CGRect {
        let startOffset = text.distance(from: text.startIndex, to: matchRange.lowerBound)
        let matchLength = text.distance(from: matchRange.lowerBound, to: matchRange.upperBound)

        // Try precise bounds via AX parameterized attribute
        var cfRange = CFRange(location: startOffset, length: matchLength)
        let rangeValue: AnyObject? = AXValueCreate(.cfRange, &cfRange)

        // kAXBoundsForRangeParameterizedAttribute is not in Swift headers, use string directly
        var boundsRef: AnyObject?
        if let rangeValue,
           AXUIElementCopyParameterizedAttributeValue(
               element,
               "AXBoundsForRange" as CFString,
               rangeValue,
               &boundsRef
           ) == .success,
           boundsRef != nil {
            var rect = CGRect.zero
            AXValueGetValue(boundsRef as! AXValue, .cgRect, &rect)
            return rect
        }

        logger.info("AXBoundsForRange unavailable, using element rect: \("\(elementRect.origin.x),\(elementRect.origin.y) \(elementRect.width)x\(elementRect.height)")")
        // Fallback: cover the entire element
        return elementRect
    }
}

// MARK: - AXObserver C Callback

private func systemMaskingCallback(
    _ observer: AXObserver,
    _ element: AXUIElement,
    _ notification: CFString,
    _ refcon: UnsafeMutableRawPointer?
) {
    guard let refcon else { return }
    let service = Unmanaged<SystemMaskingService>.fromOpaque(refcon).takeUnretainedValue()
    // Guard: only dispatch if service is still running (prevents use-after-stop)
    guard service.isRunning else { return }
    DispatchQueue.main.async { [weak service] in
        service?.handleNotification(notification as String)
    }
}
