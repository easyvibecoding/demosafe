import Foundation
import SwiftUI
import Combine
import os

private let logger = Logger(subsystem: "com.demosafe", category: "AppState")

/// Central application state coordinating all modules.
/// Acts as the dependency injection root for the app.
final class AppState: ObservableObject {
    @Published var isDemoMode: Bool = false
    @Published var activeContext: ContextMode?
    @Published var connectedClients: Int = 0

    let vaultManager: VaultManager
    let keychainService: KeychainService
    let clipboardEngine: ClipboardEngine
    let maskingCoordinator: MaskingCoordinator
    let hotkeyManager: HotkeyManager
    let ipcServer: IPCServer

    private var cancellables = Set<AnyCancellable>()

    init() {
        self.keychainService = KeychainService()
        self.vaultManager = VaultManager(keychainService: keychainService)
        self.maskingCoordinator = MaskingCoordinator(vaultManager: vaultManager)
        self.clipboardEngine = ClipboardEngine(keychainService: keychainService, maskingCoordinator: maskingCoordinator)
        self.ipcServer = IPCServer(maskingCoordinator: maskingCoordinator, clipboardEngine: clipboardEngine)
        self.hotkeyManager = HotkeyManager(maskingCoordinator: maskingCoordinator)

        // Sync isDemoMode bidirectionally with MaskingCoordinator
        maskingCoordinator.$isDemoMode
            .receive(on: RunLoop.main)
            .assign(to: &$isDemoMode)

        maskingCoordinator.$activeContext
            .receive(on: RunLoop.main)
            .assign(to: &$activeContext)

        // Load initial context
        activeContext = vaultManager.activeContext()

        // Seed default context modes if vault is empty
        if vaultManager.getAllContextModes().isEmpty {
            seedDefaultContextModes()
        }

        // Wire settings window controller
        SettingsWindowController.shared.setAppState(self)

        // Start IPC Server
        do {
            let port = try ipcServer.start()
            logger.info("IPC Server started on port \(port)")
        } catch {
            logger.error("IPC Server failed to start: \(error)")
        }

        // Start Hotkey Manager (requires Accessibility permission)
        if HotkeyManager.hasAccessibilityPermission {
            let started = hotkeyManager.start()
            logger.info("HotkeyManager started: \(started)")
        } else {
            logger.warning("Accessibility permission not granted, hotkeys disabled")
        }
    }

    func toggleDemoMode() {
        isDemoMode.toggle()
        maskingCoordinator.isDemoMode = isDemoMode
        maskingCoordinator.broadcastState()
    }

    func switchContext(contextId: UUID) {
        do {
            try vaultManager.switchContext(contextId: contextId)
            activeContext = vaultManager.activeContext()
            maskingCoordinator.activeContext = activeContext

            // Update clipboard auto-clear based on context
            if let seconds = activeContext?.clipboardClearSeconds {
                clipboardEngine.startAutoClear(seconds: seconds)
            }

            maskingCoordinator.broadcastState()
        } catch {
            // TODO: Surface error to UI
        }
    }

    func copyKey(keyId: UUID) {
        do {
            let autoClear = activeContext?.clipboardClearSeconds
            try clipboardEngine.copyToClipboard(keyId: keyId, autoClearSeconds: autoClear)
            logger.warning("Key copied successfully: \(keyId.uuidString)")
        } catch {
            logger.error("Copy key failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Private

    private func seedDefaultContextModes() {
        let defaults: [(String, ContextMode.MaskingLevel, Int?)] = [
            ("Livestream", .full, 30),
            ("Tutorial Recording", .full, 10),
            ("Internal Demo", .partial, nil),
            ("Development", .off, nil),
        ]

        for (index, (name, level, clearSeconds)) in defaults.enumerated() {
            let ctx = ContextMode(
                id: UUID(),
                name: name,
                maskingLevel: level,
                clipboardClearSeconds: clearSeconds,
                activeServiceIds: nil,
                isActive: index == 0
            )
            try? vaultManager.addContextMode(ctx)
        }

        activeContext = vaultManager.activeContext()
        maskingCoordinator.activeContext = activeContext
    }
}
