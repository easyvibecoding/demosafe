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
    let toolboxState: ToolboxState
    let toolboxController: FloatingToolboxController

    private var cancellables = Set<AnyCancellable>()

    init() {
        self.keychainService = KeychainService()
        self.vaultManager = VaultManager(keychainService: keychainService)
        self.maskingCoordinator = MaskingCoordinator(vaultManager: vaultManager)
        self.clipboardEngine = ClipboardEngine(keychainService: keychainService, maskingCoordinator: maskingCoordinator)
        self.ipcServer = IPCServer(maskingCoordinator: maskingCoordinator, clipboardEngine: clipboardEngine, vaultManager: vaultManager)
        self.hotkeyManager = HotkeyManager(maskingCoordinator: maskingCoordinator)
        self.toolboxState = ToolboxState(vaultManager: vaultManager)
        self.toolboxController = FloatingToolboxController()

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

        // Seed test keys for development (keys added by DemoSafe itself → correct Keychain ACL)
        #if DEBUG
        seedTestKeysIfNeeded()
        #endif

        // Wire settings window controller
        SettingsWindowController.shared.setAppState(self)

        // Wire floating toolbox controller
        toolboxController.setAppState(self, toolboxState: toolboxState)

        // Wire hotkey callbacks
        wireHotkeyCallbacks()

        // Install NMH (Chrome Native Messaging Host) if bundled
        NMHInstaller.installIfNeeded(extensionId: "cockodmaleagghfbaookajpcpnbdjocj")

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
            logger.info("Key copied: \(keyId.uuidString)")
        } catch {
            logger.error("Copy key failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Private — Hotkey Wiring

    private func wireHotkeyCallbacks() {
        // Toolbox show (hold start)
        hotkeyManager.onToolboxShow = { [weak self] in
            guard let self else { return }
            self.toolboxState.reset()
            self.toolboxState.isVisible = true
            let mouseLocation = NSEvent.mouseLocation
            self.toolboxController.show(near: mouseLocation)
        }

        // Toolbox release (hold end)
        hotkeyManager.onToolboxRelease = { [weak self] in
            guard let self else { return }
            self.toolboxState.handleRelease { [weak self] keyId in
                self?.copyKey(keyId: keyId)
            }
            if self.toolboxState.isLocked {
                self.hotkeyManager.isToolboxLocked = true
                self.toolboxController.makeKeyIfNeeded()
            } else {
                self.toolboxController.dismiss()
                self.hotkeyManager.isToolboxLocked = false
            }
        }

        // Toolbox keystroke (typing during hold)
        hotkeyManager.onToolboxKeystroke = { [weak self] char in
            guard let self else { return }
            if char == "\u{7f}" { // backspace
                if !self.toolboxState.searchText.isEmpty {
                    self.toolboxState.searchText.removeLast()
                }
            } else {
                self.toolboxState.searchText.append(char)
            }
        }

        // Locked mode — arrow navigation
        hotkeyManager.onToolboxArrow = { [weak self] delta in
            self?.toolboxState.moveSelection(delta: delta)
        }

        // Locked mode — Enter confirm
        hotkeyManager.onToolboxConfirm = { [weak self] in
            guard let self else { return }
            self.toolboxState.handleConfirm { [weak self] keyId in
                self?.copyKey(keyId: keyId)
            }
            self.toolboxController.dismiss()
            self.hotkeyManager.isToolboxLocked = false
        }

        // Toolbox dismiss (Esc)
        hotkeyManager.onToolboxDismiss = { [weak self] in
            guard let self else { return }
            self.toolboxState.dismiss()
            self.toolboxController.dismiss()
            self.hotkeyManager.isToolboxLocked = false
        }

        // Toggle demo mode
        hotkeyManager.onToggleDemoMode = { [weak self] in
            self?.toggleDemoMode()
        }

        // Paste key by index
        hotkeyManager.onPasteKeyByIndex = { [weak self] index in
            guard let self else { return }
            let allKeys = self.vaultManager.getAllKeys()
            guard index >= 1, index <= allKeys.count else { return }
            self.copyKey(keyId: allKeys[index - 1].id)
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

    /// Seed test keys for development. Keys are added by DemoSafe itself
    /// so Keychain ACL automatically matches the current binary.
    private func seedTestKeysIfNeeded() {
        let testKeys: [(label: String, serviceName: String, pattern: String, value: String)] = [
            ("test-key-1", "OpenAI", "sk-proj-[a-zA-Z0-9_-]+", "sk-proj-TestKey1234567890abcdef"),
            ("openai-dev", "OpenAI", "sk-proj-[a-zA-Z0-9_-]+", "sk-devTestKey9876543210"),
            ("anthropic-prod", "Anthropic", "sk-ant-[a-zA-Z0-9_-]+", "sk-ant-test1234567890abcdef"),
            ("aws-access-key", "AWS", "AKIA[0-9A-Z]{16}", "AKIAIOSFODNN7EXAMPLE1"),
            ("stripe-live", "Stripe", "sk_live_[a-zA-Z0-9]+", "sk_live_test1234567890abcdef"),
        ]

        let existingKeys = vaultManager.getAllKeys()

        for testKey in testKeys {
            // If key exists in vault, always refresh Keychain (ACL changes on rebuild)
            if let existing = existingKeys.first(where: { $0.label == testKey.label }) {
                try? keychainService.deleteKey(keyId: existing.id)
                if let data = testKey.value.data(using: .utf8) {
                    try? keychainService.storeKey(keyId: existing.id, value: data)
                }
                continue
            }

            // Find or create service
            var service = vaultManager.getAllServices().first(where: { $0.name == testKey.serviceName })
            if service == nil {
                let newService = Service(
                    id: UUID(), name: testKey.serviceName, icon: nil,
                    defaultPattern: testKey.pattern, defaultMaskFormat: .default, isBuiltIn: false
                )
                try? vaultManager.addService(newService)
                service = newService
            }

            guard let svc = service, let valueData = testKey.value.data(using: .utf8) else { continue }

            do {
                _ = try vaultManager.addKey(
                    label: testKey.label,
                    serviceId: svc.id,
                    pattern: testKey.pattern,
                    maskFormat: .default,
                    value: valueData
                )
                logger.info("Seeded test key: \(testKey.label)")
            } catch {
                logger.error("Failed to seed \(testKey.label): \(error)")
            }
        }
    }
}
