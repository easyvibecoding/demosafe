import SwiftUI

@main
struct DemoSafeApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        MenuBarExtra {
            MenuBarMenuView()
                .environmentObject(appState)
        } label: {
            Image(systemName: appState.isDemoMode ? "shield.fill" : "shield")
        }
    }

    init() {
        // Request Accessibility permission if not granted
        if !HotkeyManager.hasAccessibilityPermission {
            HotkeyManager.requestAccessibilityPermission()
        }
    }
}
