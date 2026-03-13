import XCTest
@testable import DemoSafe

final class KeychainServiceTests: XCTestCase {
    private var sut: KeychainService!
    private var testKeyId: UUID!

    override func setUp() {
        super.setUp()
        sut = KeychainService()
        testKeyId = UUID()
    }

    override func tearDown() {
        // Clean up: delete test key if it exists
        try? sut.deleteKey(keyId: testKeyId)
        super.tearDown()
    }

    // MARK: - storeKey

    func testStoreKey_success() throws {
        let value = Data("sk-proj-test1234567890abcdef".utf8)
        try sut.storeKey(keyId: testKeyId, value: value)

        // Verify it was stored by retrieving it
        let retrieved = try sut.retrieveKey(keyId: testKeyId)
        XCTAssertEqual(retrieved, value)
    }

    func testStoreKey_duplicateThrows() throws {
        let value = Data("sk-proj-test1234567890abcdef".utf8)
        try sut.storeKey(keyId: testKeyId, value: value)

        // Storing again with same keyId should throw duplicateItem
        XCTAssertThrowsError(try sut.storeKey(keyId: testKeyId, value: value)) { error in
            guard let keychainError = error as? KeychainService.KeychainError else {
                XCTFail("Expected KeychainError, got \(error)")
                return
            }
            XCTAssertEqual(keychainError, .duplicateItem)
        }
    }

    // MARK: - retrieveKey

    func testRetrieveKey_notFoundThrows() {
        let nonExistentId = UUID()
        XCTAssertThrowsError(try sut.retrieveKey(keyId: nonExistentId)) { error in
            guard let keychainError = error as? KeychainService.KeychainError else {
                XCTFail("Expected KeychainError, got \(error)")
                return
            }
            XCTAssertEqual(keychainError, .itemNotFound)
        }
    }

    func testRetrieveKey_preservesData() throws {
        // Test with various key formats
        let testValues = [
            "sk-proj-Abc1234567890xYzAbCd",
            "sk-ant-api03-AbCdEfGh1234567890xYz",
            "AKIAIOSFODNN7EXAMPLE",
            "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
        ]

        for (index, valueString) in testValues.enumerated() {
            let keyId = UUID()
            defer { try? sut.deleteKey(keyId: keyId) }

            let value = Data(valueString.utf8)
            try sut.storeKey(keyId: keyId, value: value)
            let retrieved = try sut.retrieveKey(keyId: keyId)

            XCTAssertEqual(retrieved, value, "Failed for test value at index \(index)")
            XCTAssertEqual(String(data: retrieved, encoding: .utf8), valueString)
        }
    }

    // MARK: - deleteKey

    func testDeleteKey_success() throws {
        let value = Data("sk-proj-test1234567890abcdef".utf8)
        try sut.storeKey(keyId: testKeyId, value: value)
        try sut.deleteKey(keyId: testKeyId)

        // Should no longer exist
        XCTAssertThrowsError(try sut.retrieveKey(keyId: testKeyId)) { error in
            guard let keychainError = error as? KeychainService.KeychainError else {
                XCTFail("Expected KeychainError, got \(error)")
                return
            }
            XCTAssertEqual(keychainError, .itemNotFound)
        }
    }

    func testDeleteKey_notFoundThrows() {
        let nonExistentId = UUID()
        XCTAssertThrowsError(try sut.deleteKey(keyId: nonExistentId)) { error in
            guard let keychainError = error as? KeychainService.KeychainError else {
                XCTFail("Expected KeychainError, got \(error)")
                return
            }
            XCTAssertEqual(keychainError, .itemNotFound)
        }
    }

    // MARK: - updateKey

    func testUpdateKey_success() throws {
        let original = Data("sk-proj-original-key-value-12345".utf8)
        let updated = Data("sk-proj-updated-key-value-67890".utf8)

        try sut.storeKey(keyId: testKeyId, value: original)
        try sut.updateKey(keyId: testKeyId, newValue: updated)

        let retrieved = try sut.retrieveKey(keyId: testKeyId)
        XCTAssertEqual(retrieved, updated)
        XCTAssertNotEqual(retrieved, original)
    }

    func testUpdateKey_notFoundThrows() {
        let nonExistentId = UUID()
        let value = Data("test".utf8)
        XCTAssertThrowsError(try sut.updateKey(keyId: nonExistentId, newValue: value)) { error in
            guard let keychainError = error as? KeychainService.KeychainError else {
                XCTFail("Expected KeychainError, got \(error)")
                return
            }
            XCTAssertEqual(keychainError, .itemNotFound)
        }
    }

    // MARK: - keyExists

    func testKeyExists_returnsTrueWhenStored() throws {
        let value = Data("sk-proj-test1234567890abcdef".utf8)
        try sut.storeKey(keyId: testKeyId, value: value)
        XCTAssertTrue(sut.keyExists(keyId: testKeyId))
    }

    func testKeyExists_returnsFalseWhenNotStored() {
        XCTAssertFalse(sut.keyExists(keyId: UUID()))
    }

    func testKeyExists_returnsFalseAfterDelete() throws {
        let value = Data("sk-proj-test1234567890abcdef".utf8)
        try sut.storeKey(keyId: testKeyId, value: value)
        try sut.deleteKey(keyId: testKeyId)
        XCTAssertFalse(sut.keyExists(keyId: testKeyId))
    }

    // MARK: - Isolation

    func testDifferentKeyIds_areIsolated() throws {
        let keyId1 = UUID()
        let keyId2 = UUID()
        defer {
            try? sut.deleteKey(keyId: keyId1)
            try? sut.deleteKey(keyId: keyId2)
        }

        let value1 = Data("key-one-value".utf8)
        let value2 = Data("key-two-value".utf8)

        try sut.storeKey(keyId: keyId1, value: value1)
        try sut.storeKey(keyId: keyId2, value: value2)

        XCTAssertEqual(try sut.retrieveKey(keyId: keyId1), value1)
        XCTAssertEqual(try sut.retrieveKey(keyId: keyId2), value2)

        // Deleting one doesn't affect the other
        try sut.deleteKey(keyId: keyId1)
        XCTAssertEqual(try sut.retrieveKey(keyId: keyId2), value2)
    }
}

// MARK: - Equatable for test assertions
extension KeychainService.KeychainError: Equatable {
    public static func == (lhs: KeychainService.KeychainError, rhs: KeychainService.KeychainError) -> Bool {
        switch (lhs, rhs) {
        case (.itemNotFound, .itemNotFound): return true
        case (.duplicateItem, .duplicateItem): return true
        case (.authFailed, .authFailed): return true
        case (.unexpected(let a), .unexpected(let b)): return a == b
        default: return false
        }
    }
}
