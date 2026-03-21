import AppKit
import SwiftUI
import os

private let logger = Logger(subsystem: "com.demosafe", category: "SystemOverlay")

/// Manages floating NSPanel overlays that cover detected API keys on screen.
/// Each overlay is a click-through, non-activating panel positioned over the key.
final class SystemOverlayController {
    private var overlayPanels: [UUID: NSPanel] = [:]
    private var isPeekMode = false

    // MARK: - Public API

    /// Show or update an overlay at the given screen position.
    func showOverlay(id: UUID, at axRect: CGRect, maskedText: String) {
        let panel = overlayPanels[id] ?? createOverlayPanel()
        overlayPanels[id] = panel

        let screenRect = convertAXToAppKit(axRect)
        panel.setFrame(screenRect, display: false)
        updateContent(panel, maskedText: maskedText)

        if !isPeekMode {
            panel.orderFrontRegardless()
        }
    }

    /// Remove a specific overlay.
    func removeOverlay(id: UUID) {
        if let panel = overlayPanels.removeValue(forKey: id) {
            panel.orderOut(nil)
        }
    }

    /// Remove all overlays.
    func removeAllOverlays() {
        for (_, panel) in overlayPanels {
            panel.orderOut(nil)
        }
        overlayPanels.removeAll()
    }

    /// Remove overlays not in the given set of active IDs.
    func removeStaleOverlays(activeIds: Set<UUID>) {
        let staleIds = Set(overlayPanels.keys).subtracting(activeIds)
        for id in staleIds {
            removeOverlay(id: id)
        }
    }

    /// Temporarily hide all overlays (peek mode).
    func setPeekMode(_ enabled: Bool) {
        isPeekMode = enabled
        for (_, panel) in overlayPanels {
            if enabled {
                panel.orderOut(nil)
            } else {
                panel.orderFrontRegardless()
            }
        }
    }

    var overlayCount: Int {
        overlayPanels.count
    }

    // MARK: - Private

    private func createOverlayPanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: .zero,
            styleMask: [.nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.level = .floating
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.ignoresMouseEvents = true  // Click-through
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        return panel
    }

    private func updateContent(_ panel: NSPanel, maskedText: String) {
        let view = MaskOverlayView(maskedText: maskedText)
        if let hostingView = panel.contentView as? NSHostingView<MaskOverlayView> {
            hostingView.rootView = view
        } else {
            panel.contentView = NSHostingView(rootView: view)
        }
    }

    /// Convert AX coordinates (top-left origin) to AppKit coordinates (bottom-left origin).
    ///
    /// AX uses screen coordinates with origin at top-left of primary display.
    /// AppKit uses screen coordinates with origin at bottom-left of primary display.
    /// Both use the same point scale (logical points, not pixels).
    private func convertAXToAppKit(_ axRect: CGRect) -> NSRect {
        // Primary screen height is the reference for coordinate flipping
        guard let primaryScreen = NSScreen.screens.first else {
            return NSRect(origin: .zero, size: axRect.size)
        }

        let primaryHeight = primaryScreen.frame.height
        let appKitY = primaryHeight - axRect.origin.y - axRect.height


        return NSRect(
            x: axRect.origin.x,
            y: appKitY,
            width: axRect.width,
            height: axRect.height
        )
    }
}
