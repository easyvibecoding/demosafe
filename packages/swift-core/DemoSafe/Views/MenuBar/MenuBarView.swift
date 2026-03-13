import SwiftUI
import os

private let logger = Logger(subsystem: "com.demosafe", category: "MenuBar")

/// Native menu-style MenuBarExtra content.
/// Uses SwiftUI Button/Toggle directly as menu items for reliable click handling.
struct MenuBarMenuView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        // Status
        Toggle(appState.isDemoMode ? "Demo Mode ON" : "Demo Mode OFF",
               isOn: Binding(
                get: { appState.isDemoMode },
                set: { _ in appState.toggleDemoMode() }
               ))

        if let ctx = appState.activeContext {
            Text("Context: \(ctx.name)")
                .foregroundColor(.secondary)
        }

        Divider()

        // Context Selector
        Menu("Context") {
            ForEach(appState.vaultManager.getAllContextModes()) { ctx in
                Button(action: { appState.switchContext(contextId: ctx.id) }) {
                    HStack {
                        Text(ctx.name)
                        if ctx.isActive {
                            Text("✓")
                        }
                    }
                }
            }
        }

        Divider()

        // Key Library
        let services = appState.vaultManager.getAllServices()
        if services.isEmpty {
            Text("No keys configured")
        } else {
            ForEach(services) { service in
                Menu(service.name) {
                    ForEach(appState.vaultManager.getKeys(serviceId: service.id)) { key in
                        Button("\(key.label) — Copy") {
                            appState.copyKey(keyId: key.id)
                        }
                    }
                }
            }
        }

        Divider()

        // Quick Actions
        Button("Settings...") {
            SettingsWindowController.shared.showSettings()
        }
        .keyboardShortcut(",", modifiers: .command)

        Button("Quit DemoSafe") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}
