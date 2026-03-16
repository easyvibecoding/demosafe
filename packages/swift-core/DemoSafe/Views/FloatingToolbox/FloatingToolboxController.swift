import AppKit
import SwiftUI

/// Manages a floating NSPanel that hosts the FloatingToolboxView.
/// Uses NSPanel (not NSWindow) for non-activating, always-on-top HUD behavior.
final class FloatingToolboxController {
    private var panel: NSPanel?
    private var toolboxState: ToolboxState?
    private weak var appState: AppState?

    func setAppState(_ appState: AppState, toolboxState: ToolboxState) {
        self.appState = appState
        self.toolboxState = toolboxState
    }

    /// Show the toolbox panel near the given screen coordinate.
    func show(near point: NSPoint) {
        guard let appState, let toolboxState else { return }

        if panel == nil {
            createPanel(appState: appState, toolboxState: toolboxState)
        }

        guard let panel else { return }

        // Position near cursor, clamped to screen bounds
        let panelSize = panel.frame.size
        var origin = NSPoint(
            x: point.x - panelSize.width / 2,
            y: point.y - panelSize.height - 8 // Below cursor
        )

        // Clamp to visible screen
        if let screen = NSScreen.main?.visibleFrame {
            origin.x = max(screen.minX + 4, min(origin.x, screen.maxX - panelSize.width - 4))
            origin.y = max(screen.minY + 4, min(origin.y, screen.maxY - panelSize.height - 4))
        }

        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
    }

    /// Hide the panel (kept in memory for reuse).
    func dismiss() {
        panel?.orderOut(nil)
    }

    /// Make the panel key window (needed for locked mode keyboard input).
    func makeKeyIfNeeded() {
        panel?.makeKey()
    }

    // MARK: - Private

    private func createPanel(appState: AppState, toolboxState: ToolboxState) {
        let contentView = FloatingToolboxView()
            .environmentObject(appState)
            .environmentObject(toolboxState)

        let hostingView = NSHostingView(rootView: contentView)
        hostingView.frame = NSRect(x: 0, y: 0, width: 280, height: 320)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 280, height: 320),
            styleMask: [.nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.contentView = hostingView
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        self.panel = panel
    }
}
