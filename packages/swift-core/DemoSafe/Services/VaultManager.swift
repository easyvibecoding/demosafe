import Foundation

/// Manages vault.json CRUD and all structural data persistence.
/// Broadcasts changes via NotificationCenter after each mutation.
final class VaultManager {
    static let vaultDidChangeNotification = Notification.Name("VaultManager.vaultDidChange")

    enum VaultError: Error, LocalizedError {
        case serviceNotFound(UUID)
        case keyNotFound(UUID)
        case groupNotFound(UUID)
        case contextNotFound(UUID)
        case invalidKeyIds([UUID])
        case vaultCorrupted
        case persistFailed(Error)

        var errorDescription: String? {
            switch self {
            case .serviceNotFound(let id): return "Service not found: \(id)"
            case .keyNotFound(let id): return "Key not found: \(id)"
            case .groupNotFound(let id): return "Group not found: \(id)"
            case .contextNotFound(let id): return "Context not found: \(id)"
            case .invalidKeyIds(let ids): return "Invalid key IDs: \(ids)"
            case .vaultCorrupted: return "vault.json is corrupted"
            case .persistFailed(let err): return "Failed to persist vault: \(err.localizedDescription)"
            }
        }
    }

    private let keychainService: KeychainService
    let vaultURL: URL
    private let backupURL: URL
    private(set) var vault: Vault

    init(keychainService: KeychainService, vaultURL: URL? = nil) {
        self.keychainService = keychainService

        if let url = vaultURL {
            self.vaultURL = url
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            self.vaultURL = appSupport.appendingPathComponent("DemoSafe/vault.json")
        }
        self.backupURL = self.vaultURL.appendingPathExtension("backup")

        // Load vault: try primary, then backup, then create empty
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        if let data = try? Data(contentsOf: self.vaultURL),
           let loaded = try? decoder.decode(Vault.self, from: data) {
            self.vault = loaded
        } else if let backupData = try? Data(contentsOf: self.backupURL),
                  let loaded = try? decoder.decode(Vault.self, from: backupData) {
            self.vault = loaded
        } else {
            self.vault = Vault(services: [], keys: [], linkedGroups: [], contextModes: [], patternCacheVersion: 0)
        }
    }

    // MARK: - Service CRUD

    func addService(_ service: Service) throws {
        vault.services.append(service)
        try persist()
    }

    func getService(serviceId: UUID) -> Service? {
        return vault.services.first { $0.id == serviceId }
    }

    func getAllServices() -> [Service] {
        return vault.services
    }

    // MARK: - Key CRUD

    /// Create a new KeyEntry, store its plaintext in Keychain, and persist vault.
    /// Rolls back vault changes if Keychain write fails.
    func addKey(label: String, serviceId: UUID, pattern: String, maskFormat: MaskFormat, value: Data) throws -> KeyEntry {
        guard vault.services.contains(where: { $0.id == serviceId }) else {
            throw VaultError.serviceNotFound(serviceId)
        }

        let keyId = UUID()
        let now = Date()
        let entry = KeyEntry(
            id: keyId,
            label: label,
            serviceId: serviceId,
            pattern: pattern,
            maskFormat: maskFormat,
            keychainId: "com.demosafe.key.\(keyId.uuidString)",
            createdAt: now,
            updatedAt: now,
            linkedGroupId: nil,
            sortOrder: vault.keys.filter({ $0.serviceId == serviceId }).count,
            valueHash: KeyEntry.computeHash(value)
        )

        // Store in Keychain first
        try keychainService.storeKey(keyId: keyId, value: value)

        // Add to vault and persist
        vault.keys.append(entry)
        vault.patternCacheVersion += 1

        do {
            try persist()
        } catch {
            // Rollback: remove from vault and Keychain
            vault.keys.removeAll { $0.id == keyId }
            vault.patternCacheVersion -= 1
            try? keychainService.deleteKey(keyId: keyId)
            throw VaultError.persistFailed(error)
        }

        broadcastChange()
        return entry
    }

    func deleteKey(keyId: UUID) throws {
        guard vault.keys.contains(where: { $0.id == keyId }) else {
            throw VaultError.keyNotFound(keyId)
        }

        // Remove from Keychain
        try keychainService.deleteKey(keyId: keyId)

        // Remove from vault
        vault.keys.removeAll { $0.id == keyId }

        // Remove from any linked groups
        for i in vault.linkedGroups.indices {
            vault.linkedGroups[i].keyIds.removeAll { $0 == keyId }
        }
        // Clean up empty groups
        vault.linkedGroups.removeAll { $0.keyIds.isEmpty }

        vault.patternCacheVersion += 1
        try persist()
        broadcastChange()
    }

    func getKey(keyId: UUID) -> KeyEntry? {
        return vault.keys.first { $0.id == keyId }
    }

    func getKeys(serviceId: UUID) -> [KeyEntry] {
        return vault.keys
            .filter { $0.serviceId == serviceId }
            .sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
    }

    func getAllKeys() -> [KeyEntry] {
        return vault.keys
    }

    /// Check if a key value already exists by comparing SHA-256 hashes (no Keychain access).
    func isDuplicateKey(serviceId: UUID, value: Data) -> KeyEntry? {
        let hash = KeyEntry.computeHash(value)
        return vault.keys.first { $0.serviceId == serviceId && $0.valueHash == hash }
    }

    // MARK: - LinkedGroup CRUD

    func createLinkedGroup(label: String, keyIds: [UUID], pasteMode: PasteMode) throws -> LinkedGroup {
        // Validate all keyIds exist
        let existingIds = Set(vault.keys.map { $0.id })
        let invalid = keyIds.filter { !existingIds.contains($0) }
        guard invalid.isEmpty else {
            throw VaultError.invalidKeyIds(invalid)
        }

        let group = LinkedGroup(
            id: UUID(),
            label: label,
            keyIds: keyIds,
            pasteMode: pasteMode,
            createdAt: Date()
        )

        vault.linkedGroups.append(group)

        // Update keys with linkedGroupId
        for keyId in keyIds {
            if let idx = vault.keys.firstIndex(where: { $0.id == keyId }) {
                vault.keys[idx].linkedGroupId = group.id
            }
        }

        try persist()
        broadcastChange()
        return group
    }

    func getLinkedGroup(groupId: UUID) -> LinkedGroup? {
        return vault.linkedGroups.first { $0.id == groupId }
    }

    func deleteLinkedGroup(groupId: UUID) throws {
        guard vault.linkedGroups.contains(where: { $0.id == groupId }) else {
            throw VaultError.groupNotFound(groupId)
        }

        // Clear linkedGroupId on associated keys
        for i in vault.keys.indices {
            if vault.keys[i].linkedGroupId == groupId {
                vault.keys[i].linkedGroupId = nil
            }
        }

        vault.linkedGroups.removeAll { $0.id == groupId }
        try persist()
        broadcastChange()
    }

    // MARK: - ContextMode

    func activeContext() -> ContextMode? {
        return vault.contextModes.first { $0.isActive }
    }

    func switchContext(contextId: UUID) throws {
        guard vault.contextModes.contains(where: { $0.id == contextId }) else {
            throw VaultError.contextNotFound(contextId)
        }

        // Deactivate all, activate target
        for i in vault.contextModes.indices {
            vault.contextModes[i].isActive = (vault.contextModes[i].id == contextId)
        }

        try persist()
        broadcastChange()
    }

    func addContextMode(_ context: ContextMode) throws {
        vault.contextModes.append(context)
        try persist()
    }

    func getAllContextModes() -> [ContextMode] {
        return vault.contextModes
    }

    // MARK: - Import / Export

    func exportStructure() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(vault)
    }

    func importStructure(data: Data) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        guard let imported = try? decoder.decode(Vault.self, from: data) else {
            throw VaultError.vaultCorrupted
        }

        vault = imported
        try persist()
        broadcastChange()
    }

    // MARK: - Private

    private func persist() throws {
        let dir = vaultURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(vault)

        // Backup current vault before overwriting
        if FileManager.default.fileExists(atPath: vaultURL.path) {
            try? FileManager.default.removeItem(at: backupURL)
            try? FileManager.default.copyItem(at: vaultURL, to: backupURL)
        }

        // Atomic write
        try data.write(to: vaultURL, options: .atomic)
    }

    private func broadcastChange() {
        NotificationCenter.default.post(name: Self.vaultDidChangeNotification, object: self)
    }
}
