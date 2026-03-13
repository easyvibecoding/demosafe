import XCTest
import AppKit
@testable import DemoSafe

final class ClipboardEngineTests: XCTestCase {
    private var sut: ClipboardEngine!
    private var keychainService: KeychainService!
    private var testKeyId: UUID!

    override func setUp() {
        super.setUp()
        keychainService = KeychainService()
        sut = ClipboardEngine(keychainService: keychainService)
        testKeyId = UUID()
    }

    override func tearDown() {
        try? keychainService.deleteKey(keyId: testKeyId)
        // Restore clipboard to a clean state
        NSPasteboard.general.clearContents()
        super.tearDown()
    }

    // MARK: - Helpers

    private func storeTestKey(value: String = "sk-proj-TestKey1234567890abcdef") throws {
        try keychainService.storeKey(keyId: testKeyId, value: Data(value.utf8))
    }

    // MARK: - copyToClipboard

    func testCopyToClipboard_writesToPasteboard() throws {
        let value = "sk-proj-TestKey1234567890abcdef"
        try storeTestKey(value: value)

        try sut.copyToClipboard(keyId: testKeyId)

        let clipboard = NSPasteboard.general.string(forType: .string)
        XCTAssertEqual(clipboard, value)
    }

    func testCopyToClipboard_keyNotFoundThrows() {
        let fakeId = UUID()
        XCTAssertThrowsError(try sut.copyToClipboard(keyId: fakeId))
    }

    func testCopyToClipboard_consecutiveSameKey_resetsTimer() throws {
        try storeTestKey()

        try sut.copyToClipboard(keyId: testKeyId, autoClearSeconds: 30)
        XCTAssertTrue(sut.isAutoClearScheduled)

        // Copying same key again should not re-write but reset timer
        try sut.copyToClipboard(keyId: testKeyId, autoClearSeconds: 30)
        XCTAssertTrue(sut.isAutoClearScheduled)
    }

    func testCopyToClipboard_differentKey_replaces() throws {
        let value1 = "sk-proj-FirstKey12345678901234"
        try storeTestKey(value: value1)
        try sut.copyToClipboard(keyId: testKeyId)

        let secondKeyId = UUID()
        let value2 = "sk-proj-SecondKey1234567890123"
        try keychainService.storeKey(keyId: secondKeyId, value: Data(value2.utf8))
        defer { try? keychainService.deleteKey(keyId: secondKeyId) }

        try sut.copyToClipboard(keyId: secondKeyId)

        let clipboard = NSPasteboard.general.string(forType: .string)
        XCTAssertEqual(clipboard, value2)
    }

    // MARK: - clearClipboard

    func testClearClipboard_emptiesPasteboard() throws {
        try storeTestKey()
        try sut.copyToClipboard(keyId: testKeyId)

        sut.clearClipboard()

        let clipboard = NSPasteboard.general.string(forType: .string)
        XCTAssertNil(clipboard)
    }

    func testClearClipboard_invalidatesTimer() throws {
        try storeTestKey()
        try sut.copyToClipboard(keyId: testKeyId, autoClearSeconds: 60)
        XCTAssertTrue(sut.isAutoClearScheduled)

        sut.clearClipboard()
        XCTAssertFalse(sut.isAutoClearScheduled)
    }

    // MARK: - startAutoClear

    func testAutoClear_clearsAfterDelay() throws {
        try storeTestKey()
        try sut.copyToClipboard(keyId: testKeyId)

        let expectation = expectation(description: "Clipboard cleared")

        NotificationCenter.default.addObserver(forName: Notification.Name("ClipboardEngine.clipboardCleared"), object: sut, queue: nil) { _ in
            expectation.fulfill()
        }

        sut.startAutoClear(seconds: 1)

        wait(for: [expectation], timeout: 3.0)

        let clipboard = NSPasteboard.general.string(forType: .string)
        XCTAssertNil(clipboard)
    }

    // MARK: - Confidence scoring

    func testDetectKeys_withKnownPatterns() throws {
        // Set up vault with patterns for detection
        let testVaultURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ClipboardTests-\(UUID().uuidString)")
            .appendingPathComponent("vault.json")
        defer { try? FileManager.default.removeItem(at: testVaultURL.deletingLastPathComponent()) }

        let vaultManager = VaultManager(keychainService: keychainService, vaultURL: testVaultURL)
        let coordinator = MaskingCoordinator(vaultManager: vaultManager)
        let engine = ClipboardEngine(keychainService: keychainService, maskingCoordinator: coordinator)

        let service = Service(id: UUID(), name: "OpenAI", icon: nil, defaultPattern: "sk-proj-[A-Za-z0-9_-]{20,}", defaultMaskFormat: .default, isBuiltIn: true)
        try vaultManager.addService(service)

        let keyValue = "sk-proj-DetectMe12345678901234"
        let key = try vaultManager.addKey(label: "Test", serviceId: service.id, pattern: "sk-proj-[A-Za-z0-9_-]{20,}", maskFormat: .default, value: Data(keyValue.utf8))
        defer { try? keychainService.deleteKey(keyId: key.id) }

        // Put a key-like string on the clipboard
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("sk-proj-SomeRandomKey1234567890xx", forType: .string)

        let detected = engine.detectKeysInClipboard()
        XCTAssertEqual(detected.count, 1)
        XCTAssertEqual(detected.first?.suggestedService, "OpenAI")
        XCTAssertGreaterThan(detected.first?.confidence ?? 0, 0.5)
    }
}
