import XCTest
@testable import DemoSafe

final class VaultManagerTests: XCTestCase {
    private var sut: VaultManager!
    private var keychainService: KeychainService!
    private var testVaultURL: URL!
    private var createdKeyIds: [UUID] = []

    override func setUp() {
        super.setUp()
        keychainService = KeychainService()
        // Use temp directory for vault to avoid polluting real data
        testVaultURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("DemoSafeTests-\(UUID().uuidString)")
            .appendingPathComponent("vault.json")
        sut = VaultManager(keychainService: keychainService, vaultURL: testVaultURL)
        createdKeyIds = []
    }

    override func tearDown() {
        // Clean up Keychain entries
        for keyId in createdKeyIds {
            try? keychainService.deleteKey(keyId: keyId)
        }
        // Clean up temp vault files
        let dir = testVaultURL.deletingLastPathComponent()
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    // MARK: - Helpers

    private func addTestService(name: String = "TestService") throws -> Service {
        let service = Service(
            id: UUID(),
            name: name,
            icon: nil,
            defaultPattern: "test-[A-Za-z0-9]{10,}",
            defaultMaskFormat: .default,
            isBuiltIn: false
        )
        try sut.addService(service)
        return service
    }

    private func addTestKey(serviceId: UUID, label: String = "Test Key") throws -> KeyEntry {
        let entry = try sut.addKey(
            label: label,
            serviceId: serviceId,
            pattern: "test-[A-Za-z0-9]{10,}",
            maskFormat: .default,
            value: Data("test-key-value-1234567890".utf8)
        )
        createdKeyIds.append(entry.id)
        return entry
    }

    // MARK: - Service Tests

    func testAddService_success() throws {
        let service = try addTestService(name: "OpenAI")
        XCTAssertEqual(sut.getAllServices().count, 1)
        XCTAssertEqual(sut.getService(serviceId: service.id)?.name, "OpenAI")
    }

    // MARK: - Key CRUD Tests

    func testAddKey_success() throws {
        let service = try addTestService()
        let key = try addTestKey(serviceId: service.id)

        XCTAssertEqual(sut.getAllKeys().count, 1)
        XCTAssertEqual(sut.getKey(keyId: key.id)?.label, "Test Key")
        XCTAssertTrue(keychainService.keyExists(keyId: key.id))
    }

    func testAddKey_serviceNotFoundThrows() {
        let fakeServiceId = UUID()
        XCTAssertThrowsError(
            try sut.addKey(label: "Test", serviceId: fakeServiceId, pattern: ".*", maskFormat: .default, value: Data("val".utf8))
        )
    }

    func testDeleteKey_success() throws {
        let service = try addTestService()
        let key = try addTestKey(serviceId: service.id)

        try sut.deleteKey(keyId: key.id)

        XCTAssertNil(sut.getKey(keyId: key.id))
        XCTAssertFalse(keychainService.keyExists(keyId: key.id))
        createdKeyIds.removeAll { $0 == key.id }
    }

    func testDeleteKey_notFoundThrows() {
        XCTAssertThrowsError(try sut.deleteKey(keyId: UUID()))
    }

    func testGetKeys_filtersByService() throws {
        let service1 = try addTestService(name: "Service A")
        let service2 = try addTestService(name: "Service B")

        let _ = try addTestKey(serviceId: service1.id, label: "Key A1")
        let _ = try addTestKey(serviceId: service1.id, label: "Key A2")
        let _ = try addTestKey(serviceId: service2.id, label: "Key B1")

        XCTAssertEqual(sut.getKeys(serviceId: service1.id).count, 2)
        XCTAssertEqual(sut.getKeys(serviceId: service2.id).count, 1)
    }

    // MARK: - LinkedGroup Tests

    func testCreateLinkedGroup_success() throws {
        let service = try addTestService()
        let key1 = try addTestKey(serviceId: service.id, label: "Key 1")
        let key2 = try addTestKey(serviceId: service.id, label: "Key 2")

        let entries = [
            GroupEntry(keyId: key1.id, fieldLabel: "Access Key ID", sortOrder: 0),
            GroupEntry(keyId: key2.id, fieldLabel: "Secret Key", sortOrder: 1),
        ]
        let group = try sut.createLinkedGroup(label: "AWS Pair", entries: entries, pasteMode: .selectField)

        XCTAssertEqual(sut.getLinkedGroup(groupId: group.id)?.label, "AWS Pair")
        XCTAssertEqual(sut.getLinkedGroup(groupId: group.id)?.entries.count, 2)
        // Keys should reference the group
        XCTAssertEqual(sut.getKey(keyId: key1.id)?.linkedGroupId, group.id)
        XCTAssertEqual(sut.getKey(keyId: key2.id)?.linkedGroupId, group.id)
    }

    func testCreateLinkedGroup_invalidKeyIdsThrows() throws {
        let entries = [GroupEntry(keyId: UUID(), fieldLabel: "Bad Key", sortOrder: 0)]
        XCTAssertThrowsError(
            try sut.createLinkedGroup(label: "Bad", entries: entries, pasteMode: .selectField)
        )
    }

    func testDeleteLinkedGroup_clearsKeyReferences() throws {
        let service = try addTestService()
        let key = try addTestKey(serviceId: service.id)
        let entries = [GroupEntry(keyId: key.id, fieldLabel: "API Key", sortOrder: 0)]
        let group = try sut.createLinkedGroup(label: "Group", entries: entries, pasteMode: .selectField)

        try sut.deleteLinkedGroup(groupId: group.id)

        XCTAssertNil(sut.getLinkedGroup(groupId: group.id))
        XCTAssertNil(sut.getKey(keyId: key.id)?.linkedGroupId)
    }

    func testDeleteKey_removesFromLinkedGroup() throws {
        let service = try addTestService()
        let key1 = try addTestKey(serviceId: service.id, label: "Key 1")
        let key2 = try addTestKey(serviceId: service.id, label: "Key 2")

        let entries = [
            GroupEntry(keyId: key1.id, fieldLabel: "Access Key", sortOrder: 0),
            GroupEntry(keyId: key2.id, fieldLabel: "Secret Key", sortOrder: 1),
        ]
        let group = try sut.createLinkedGroup(label: "Pair", entries: entries, pasteMode: .selectField)

        try sut.deleteKey(keyId: key1.id)
        createdKeyIds.removeAll { $0 == key1.id }

        // Group should still exist with remaining key
        let updatedGroup = sut.getLinkedGroup(groupId: group.id)
        XCTAssertEqual(updatedGroup?.entries.count, 1)
        XCTAssertEqual(updatedGroup?.entries.first?.keyId, key2.id)
    }

    func testCreateLinkedGroup_sequential() throws {
        let service = try addTestService()
        let key1 = try addTestKey(serviceId: service.id, label: "Key 1")
        let key2 = try addTestKey(serviceId: service.id, label: "Key 2")

        let entries = [
            GroupEntry(keyId: key1.id, fieldLabel: "Access Key ID", sortOrder: 0),
            GroupEntry(keyId: key2.id, fieldLabel: "Secret Key", sortOrder: 1),
        ]
        let group = try sut.createLinkedGroup(label: "AWS Sequential", entries: entries, pasteMode: .sequential)

        XCTAssertEqual(group.pasteMode, .sequential)
        XCTAssertEqual(group.sortedKeyIds, [key1.id, key2.id])
    }

    func testDeleteKey_removesEmptyGroup() throws {
        let service = try addTestService()
        let key = try addTestKey(serviceId: service.id)

        let entries = [GroupEntry(keyId: key.id, fieldLabel: "Only Key", sortOrder: 0)]
        let group = try sut.createLinkedGroup(label: "Solo", entries: entries, pasteMode: .selectField)

        try sut.deleteKey(keyId: key.id)
        createdKeyIds.removeAll { $0 == key.id }

        // Group should be auto-removed since it's now empty
        XCTAssertNil(sut.getLinkedGroup(groupId: group.id))
    }

    // MARK: - ContextMode Tests

    func testSwitchContext_activatesTarget() throws {
        let ctx1 = ContextMode(id: UUID(), name: "Livestream", maskingLevel: .full, clipboardClearSeconds: 30, activeServiceIds: nil, isActive: true)
        let ctx2 = ContextMode(id: UUID(), name: "Development", maskingLevel: .off, clipboardClearSeconds: nil, activeServiceIds: nil, isActive: false)

        try sut.addContextMode(ctx1)
        try sut.addContextMode(ctx2)

        XCTAssertEqual(sut.activeContext()?.name, "Livestream")

        try sut.switchContext(contextId: ctx2.id)

        XCTAssertEqual(sut.activeContext()?.name, "Development")
    }

    func testSwitchContext_notFoundThrows() {
        XCTAssertThrowsError(try sut.switchContext(contextId: UUID()))
    }

    // MARK: - Persistence Tests

    func testPersistence_survivesReload() throws {
        let service = try addTestService(name: "Persisted")
        let _ = try addTestKey(serviceId: service.id, label: "Persisted Key")

        // Create new VaultManager pointing to same file
        let reloaded = VaultManager(keychainService: keychainService, vaultURL: testVaultURL)

        XCTAssertEqual(reloaded.getAllServices().count, 1)
        XCTAssertEqual(reloaded.getAllServices().first?.name, "Persisted")
        XCTAssertEqual(reloaded.getAllKeys().count, 1)
        XCTAssertEqual(reloaded.getAllKeys().first?.label, "Persisted Key")
    }

    func testPatternCacheVersion_incrementsOnKeyChanges() throws {
        let service = try addTestService()
        let initialVersion = sut.vault.patternCacheVersion

        let key = try addTestKey(serviceId: service.id)
        XCTAssertEqual(sut.vault.patternCacheVersion, initialVersion + 1)

        try sut.deleteKey(keyId: key.id)
        createdKeyIds.removeAll { $0 == key.id }
        XCTAssertEqual(sut.vault.patternCacheVersion, initialVersion + 2)
    }

    // MARK: - Export / Import

    func testExportImport_roundTrip() throws {
        let service = try addTestService(name: "Exported")
        let _ = try addTestKey(serviceId: service.id, label: "Export Key")

        let exported = try sut.exportStructure()

        // Create fresh vault and import
        let newURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("DemoSafeTests-import-\(UUID().uuidString)")
            .appendingPathComponent("vault.json")
        defer { try? FileManager.default.removeItem(at: newURL.deletingLastPathComponent()) }

        let fresh = VaultManager(keychainService: keychainService, vaultURL: newURL)
        try fresh.importStructure(data: exported)

        XCTAssertEqual(fresh.getAllServices().first?.name, "Exported")
        XCTAssertEqual(fresh.getAllKeys().first?.label, "Export Key")
    }

    // MARK: - Notification

    func testBroadcastsNotification_onKeyAdd() throws {
        let service = try addTestService()
        let expectation = expectation(forNotification: VaultManager.vaultDidChangeNotification, object: sut)

        let key = try addTestKey(serviceId: service.id)
        _ = key

        wait(for: [expectation], timeout: 1.0)
    }
}
