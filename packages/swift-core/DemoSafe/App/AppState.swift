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
    let sequentialPasteEngine: SequentialPasteEngine
    let toolboxState: ToolboxState
    let toolboxController: FloatingToolboxController

    private var cancellables = Set<AnyCancellable>()

    init() {
        self.keychainService = KeychainService()
        self.vaultManager = VaultManager(keychainService: keychainService)
        self.maskingCoordinator = MaskingCoordinator(vaultManager: vaultManager)
        self.clipboardEngine = ClipboardEngine(keychainService: keychainService, maskingCoordinator: maskingCoordinator)
        self.sequentialPasteEngine = SequentialPasteEngine(clipboardEngine: clipboardEngine, keychainService: keychainService)
        self.ipcServer = IPCServer(maskingCoordinator: maskingCoordinator, clipboardEngine: clipboardEngine, vaultManager: vaultManager, keychainService: keychainService)
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

        // Paste key by index (group-aware)
        hotkeyManager.onPasteKeyByIndex = { [weak self] index in
            guard let self else { return }
            let allKeys = self.vaultManager.getAllKeys()
            guard index >= 1, index <= allKeys.count else { return }
            let key = allKeys[index - 1]

            // If key belongs to a sequential group, paste the entire group
            if let groupId = key.linkedGroupId,
               let group = self.vaultManager.getLinkedGroup(groupId: groupId),
               group.pasteMode == .sequential {
                let autoClear = self.activeContext?.clipboardClearSeconds
                Task {
                    do {
                        try await self.sequentialPasteEngine.pasteGroupSequentially(group, autoClearSeconds: autoClear)
                    } catch {
                        logger.error("Sequential paste failed: \(error.localizedDescription)")
                    }
                }
            } else {
                self.copyKey(keyId: key.id)
            }
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
