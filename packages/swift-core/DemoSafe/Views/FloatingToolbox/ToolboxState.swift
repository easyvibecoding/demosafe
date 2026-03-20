import Foundation
import Combine
import os

private let logger = Logger(subsystem: "com.demosafe", category: "ToolboxState")

/// ViewModel managing all floating toolbox interaction state.
/// Separates toolbox logic from the view layer for testability.
final class ToolboxState: ObservableObject {
    @Published var isVisible = false
    @Published var isLocked = false
    @Published var searchText = ""
    @Published var selectedIndex = 0

    private let vaultManager: VaultManager

    struct KeyItem: Identifiable {
        let key: KeyEntry
        let serviceName: String
        let index: Int // 1-based display index
        let groupLabel: String?   // LinkedGroup label if key belongs to a group
        let fieldLabel: String?   // GroupEntry fieldLabel if key belongs to a group
        var id: UUID { key.id }
    }

    init(vaultManager: VaultManager) {
        self.vaultManager = vaultManager
    }

    /// All keys with service names and group info, filtered by search text.
    var filteredKeys: [KeyItem] {
        let services = vaultManager.getAllServices()
        var items: [KeyItem] = []
        var idx = 1

        // Build group lookup for efficiency
        var groupLookup: [UUID: LinkedGroup] = [:]
        for group in vaultManager.vault.linkedGroups {
            groupLookup[group.id] = group
        }

        for service in services {
            let keys = vaultManager.getKeys(serviceId: service.id)
            for key in keys {
                var groupLabel: String?
                var fieldLabel: String?

                if let groupId = key.linkedGroupId, let group = groupLookup[groupId] {
                    groupLabel = group.label
                    fieldLabel = group.entries.first(where: { $0.keyId == key.id })?.fieldLabel
                }

                items.append(KeyItem(
                    key: key, serviceName: service.name, index: idx,
                    groupLabel: groupLabel, fieldLabel: fieldLabel
                ))
                idx += 1
            }
        }

        if searchText.isEmpty { return items }

        let query = searchText.lowercased()
        return items.filter {
            $0.key.label.lowercased().contains(query) ||
            $0.serviceName.lowercased().contains(query) ||
            ($0.groupLabel?.lowercased().contains(query) ?? false) ||
            ($0.fieldLabel?.lowercased().contains(query) ?? false)
        }
    }

    /// Called when modifier keys are released.
    /// If 1 result: auto-copy and dismiss. If >1: enter locked mode.
    func handleRelease(copyAction: (UUID) -> Void) {
        let keys = filteredKeys
        logger.warning("handleRelease: filteredKeys.count=\(keys.count), searchText='\(self.searchText)'")

        if keys.count == 1 {
            let keyId = keys[0].key.id
            logger.warning("Auto-copy key: \(keyId.uuidString)")
            copyAction(keyId)
            dismiss()
        } else if keys.count > 1 {
            isLocked = true
            selectedIndex = 0
        } else {
            dismiss()
        }
    }

    /// Called when Enter is pressed in locked mode.
    func handleConfirm(copyAction: (UUID) -> Void) {
        let keys = filteredKeys
        guard selectedIndex >= 0, selectedIndex < keys.count else {
            dismiss()
            return
        }
        copyAction(keys[selectedIndex].key.id)
        dismiss()
    }

    /// Arrow key navigation in locked mode.
    func moveSelection(delta: Int) {
        let count = filteredKeys.count
        guard count > 0 else { return }
        selectedIndex = max(0, min(count - 1, selectedIndex + delta))
    }

    /// Reset all state for next invocation.
    func reset() {
        searchText = ""
        selectedIndex = 0
        isLocked = false
        isVisible = false
    }

    /// Hide and reset.
    func dismiss() {
        reset()
    }
}
