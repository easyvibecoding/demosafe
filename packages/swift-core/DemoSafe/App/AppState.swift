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

        // Capture clipboard
        hotkeyManager.onCaptureClipboard = { [weak self] in
            self?.handleCaptureClipboard()
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

    // MARK: - Clipboard Capture

    private func handleCaptureClipboard() {
        let detected = clipboardEngine.detectKeysInClipboard()

        if detected.isEmpty {
            logger.info("Capture clipboard: no keys detected")
            _ = showAlert(title: "No Keys Found", message: "No API key patterns detected in clipboard content.")
            return
        }

        logger.info("Capture clipboard: found \(detected.count) key(s)")

        for key in detected {
            if key.confidence >= 0.7 {
                // High confidence — auto-store
                storeDetectedKey(key)
            } else if key.confidence >= 0.35 {
                // Medium confidence — confirm with user
                let prefix = String(key.rawValue.prefix(8))
                let suffix = String(key.rawValue.suffix(4))
                let preview = "\(prefix)...\(suffix) (\(key.rawValue.count) chars)"

                let response = showAlert(
                    title: "Store Detected Key?",
                    message: "Service: \(key.suggestedService ?? "Unknown")\nKey: \(preview)\nConfidence: \(Int(key.confidence * 100))%",
                    buttons: ["Store", "Skip"]
                )
                if response == .alertFirstButtonReturn {
                    storeDetectedKey(key)
                } else {
                    logger.info("Capture clipboard: user skipped key")
                }
            } else {
                // Low confidence — ignore
                logger.info("Capture clipboard: ignoring low confidence key (\(key.confidence))")
            }
        }
    }

    private func storeDetectedKey(_ detected: DetectedKey) {
        let rawValue = detected.rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let serviceName = detected.suggestedService ?? "Unknown"

        // Find or create service
        var service = vaultManager.getAllServices().first(where: { $0.name == serviceName })
        if service == nil {
            let newService = Service(
                id: UUID(), name: serviceName, icon: nil,
                defaultPattern: ".*", defaultMaskFormat: .default, isBuiltIn: false
            )
            try? vaultManager.addService(newService)
            service = newService
        }

        guard let svc = service, let valueData = rawValue.data(using: .utf8) else {
            logger.error("Capture clipboard: failed to encode key value")
            return
        }

        // Deduplicate
        if let existing = vaultManager.isDuplicateKey(serviceId: svc.id, value: valueData) {
            logger.info("Capture clipboard: duplicate key '\(existing.label)', skipping")
            _ = showAlert(title: "Duplicate Key", message: "This key already exists as '\(existing.label)'.")
            return
        }

        let label = "\(serviceName.lowercased())-\(Int(Date().timeIntervalSince1970) % 100000)"
        let structuralPattern = IPCServer.deriveStructuralPattern(from: rawValue)

        do {
            _ = try vaultManager.addKey(
                label: label,
                serviceId: svc.id,
                pattern: structuralPattern,
                maskFormat: svc.defaultMaskFormat,
                value: valueData
            )
            logger.info("Capture clipboard: stored key '\(label)'")
            _ = showAlert(title: "Key Stored", message: "Saved as '\(label)' under \(serviceName).")
        } catch {
            logger.error("Capture clipboard: store failed: \(error)")
        }
    }

    private func showAlert(title: String, message: String, buttons: [String] = ["OK"]) -> NSApplication.ModalResponse {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        for button in buttons {
            alert.addButton(withTitle: button)
        }

        // Use lock icon instead of default folder icon
        alert.icon = NSImage(systemSymbolName: "lock.shield", accessibilityDescription: "DemoSafe")

        // Pre-configure window to float above all windows
        alert.layout()
        alert.window.level = .floating

        // Position near top-right (like system notifications)
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let alertSize = alert.window.frame.size
            let x = screenFrame.maxX - alertSize.width - 20
            let y = screenFrame.maxY - alertSize.height - 20
            alert.window.setFrameOrigin(NSPoint(x: x, y: y))
        }

        alert.window.orderFrontRegardless()

        return alert.runModal()
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
