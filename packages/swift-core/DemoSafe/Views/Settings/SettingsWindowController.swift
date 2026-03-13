import AppKit
import SwiftUI

final class SettingsWindowController {
    static let shared = SettingsWindowController()

    private var window: NSWindow?
    private var appState: AppState?

    func setAppState(_ appState: AppState) {
        self.appState = appState
    }

    func showSettings() {
        // Temporarily become a regular app so the window can come to front
        NSApp.setActivationPolicy(.regular)

        if let window = window, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            window.orderFrontRegardless()
            return
        }

        guard let appState = appState else { return }

        let settingsView = SettingsView()
            .environmentObject(appState)

        let hostingController = NSHostingController(rootView: settingsView)

        let window = NSWindow(contentViewController: hostingController)
        window.title = "DemoSafe Settings"
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.setContentSize(NSSize(width: 560, height: 420))
        window.center()
        window.isReleasedWhenClosed = false
        window.level = .floating  // Ensure it floats above other windows initially

        // When window closes, revert to accessory app (no dock icon)
        window.delegate = WindowCloseDelegate.shared

        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()

        // After appearing, set back to normal level so it behaves normally
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            window.level = .normal
        }

        self.window = window
    }
}

final class WindowCloseDelegate: NSObject, NSWindowDelegate {
    static let shared = WindowCloseDelegate()

    func windowWillClose(_ notification: Notification) {
        // Revert to accessory (menu bar only, no dock icon)
        NSApp.setActivationPolicy(.accessory)
    }
}
