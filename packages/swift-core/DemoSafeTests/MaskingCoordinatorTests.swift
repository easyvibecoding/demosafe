import XCTest
@testable import DemoSafe

final class MaskingCoordinatorTests: XCTestCase {
    private var sut: MaskingCoordinator!
    private var vaultManager: VaultManager!
    private var keychainService: KeychainService!
    private var testVaultURL: URL!
    private var createdKeyIds: [UUID] = []

    override func setUp() {
        super.setUp()
        keychainService = KeychainService()
        testVaultURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("DemoSafeTests-Masking-\(UUID().uuidString)")
            .appendingPathComponent("vault.json")
        vaultManager = VaultManager(keychainService: keychainService, vaultURL: testVaultURL)
        sut = MaskingCoordinator(vaultManager: vaultManager)
        createdKeyIds = []
    }

    override func tearDown() {
        for keyId in createdKeyIds {
            try? keychainService.deleteKey(keyId: keyId)
        }
        try? FileManager.default.removeItem(at: testVaultURL.deletingLastPathComponent())
        super.tearDown()
    }

    // MARK: - Helpers

    private func setupDemoMode() throws {
        let ctx = ContextMode(id: UUID(), name: "Livestream", maskingLevel: .full, clipboardClearSeconds: 30, activeServiceIds: nil, isActive: true)
        try vaultManager.addContextMode(ctx)
        sut.isDemoMode = true
        sut.activeContext = ctx
    }

    private func addServiceAndKey(serviceName: String, pattern: String, showPrefix: Int, value: String) throws -> (Service, KeyEntry) {
        let service = Service(id: UUID(), name: serviceName, icon: nil, defaultPattern: pattern, defaultMaskFormat: MaskFormat(showPrefix: showPrefix, showSuffix: 0, maskChar: "*", separator: "..."), isBuiltIn: true)
        try vaultManager.addService(service)

        let key = try vaultManager.addKey(
            label: "\(serviceName) Key",
            serviceId: service.id,
            pattern: pattern,
            maskFormat: MaskFormat(showPrefix: showPrefix, showSuffix: 0, maskChar: "*", separator: "..."),
            value: Data(value.utf8)
        )
        createdKeyIds.append(key.id)
        return (service, key)
    }

    // MARK: - shouldMask Tests

    func testShouldMask_returnsEmpty_whenNotDemoMode() throws {
        let (_, _) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-Abc1234567890xYzAbCd")

        sut.isDemoMode = false
        let results = sut.shouldMask(text: "My key is sk-proj-Abc1234567890xYzAbCd here")
        XCTAssertTrue(results.isEmpty)
    }

    func testShouldMask_detectsOpenAIKey() throws {
        try setupDemoMode()
        let (_, _) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-Abc1234567890xYzAbCd")

        let text = "export OPENAI_KEY=sk-proj-Abc1234567890xYzAbCd"
        let results = sut.shouldMask(text: text)

        XCTAssertEqual(results.count, 1)
        XCTAssertTrue(results[0].maskedText.hasPrefix("sk-proj-"))
        XCTAssertTrue(results[0].maskedText.contains("****"))
    }

    func testShouldMask_detectsMultipleKeys() throws {
        try setupDemoMode()
        let (_, _) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-Abc1234567890xYzAbCd")
        let (_, _) = try addServiceAndKey(serviceName: "GitHub", pattern: "ghp_[A-Za-z0-9]{36}", showPrefix: 4, value: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789")

        let text = """
        OPENAI_KEY=sk-proj-Abc1234567890xYzAbCd
        GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789
        """
        let results = sut.shouldMask(text: text)
        XCTAssertEqual(results.count, 2)
    }

    func testShouldMask_respectsActiveServiceIds() throws {
        let openai = Service(id: UUID(), name: "OpenAI", icon: nil, defaultPattern: "sk-proj-[A-Za-z0-9_-]{20,}", defaultMaskFormat: .default, isBuiltIn: true)
        let github = Service(id: UUID(), name: "GitHub", icon: nil, defaultPattern: "ghp_[A-Za-z0-9]{36}", defaultMaskFormat: .default, isBuiltIn: true)
        try vaultManager.addService(openai)
        try vaultManager.addService(github)

        let key1 = try vaultManager.addKey(label: "OAI", serviceId: openai.id, pattern: "sk-proj-[A-Za-z0-9_-]{20,}", maskFormat: .default, value: Data("sk-proj-Abc1234567890xYzAbCd".utf8))
        createdKeyIds.append(key1.id)
        let key2 = try vaultManager.addKey(label: "GH", serviceId: github.id, pattern: "ghp_[A-Za-z0-9]{36}", maskFormat: .default, value: Data("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789".utf8))
        createdKeyIds.append(key2.id)

        // Context only allows OpenAI
        let ctx = ContextMode(id: UUID(), name: "Partial", maskingLevel: .full, clipboardClearSeconds: nil, activeServiceIds: [openai.id], isActive: true)
        try vaultManager.addContextMode(ctx)
        sut.isDemoMode = true
        sut.activeContext = ctx

        let text = "sk-proj-Abc1234567890xYzAbCd and ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"
        let results = sut.shouldMask(text: text)

        // Only OpenAI key should be masked
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].serviceId, openai.id)
    }

    func testShouldMask_returnsEmpty_whenMaskingOff() throws {
        let (_, _) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-Abc1234567890xYzAbCd")

        let ctx = ContextMode(id: UUID(), name: "Dev", maskingLevel: .off, clipboardClearSeconds: nil, activeServiceIds: nil, isActive: true)
        try vaultManager.addContextMode(ctx)
        sut.isDemoMode = true
        sut.activeContext = ctx

        let results = sut.shouldMask(text: "sk-proj-Abc1234567890xYzAbCd")
        XCTAssertTrue(results.isEmpty)
    }

    // MARK: - applyMask Tests

    func testApplyMask_withPrefix() {
        let format = MaskFormat(showPrefix: 8, showSuffix: 0, maskChar: "*", separator: "...")
        let result = sut.applyMask("sk-proj-Abc1234567890xYzAbCd", format: format)
        XCTAssertTrue(result.hasPrefix("sk-proj-"))
        XCTAssertTrue(result.contains("****"))
        XCTAssertTrue(result.contains("..."))
    }

    func testApplyMask_fullMask() {
        let format = MaskFormat(showPrefix: 0, showSuffix: 0, maskChar: "*", separator: "...")
        let result = sut.applyMask("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", format: format)
        XCTAssertEqual(result, "****...****")
    }

    func testApplyMask_withSuffix() {
        let format = MaskFormat(showPrefix: 0, showSuffix: 4, maskChar: "*", separator: "...")
        let result = sut.applyMask("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", format: format)
        XCTAssertTrue(result.hasSuffix("o5p6"))
        XCTAssertTrue(result.hasPrefix("****"))
    }

    // MARK: - Pattern Cache

    func testPatternCacheEntries_containsAllKeys() throws {
        try setupDemoMode()
        let (_, _) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-test")
        let (_, _) = try addServiceAndKey(serviceName: "GitHub", pattern: "ghp_[A-Za-z0-9]{36}", showPrefix: 4, value: "ghp_test")

        let entries = sut.patternCacheEntries()
        XCTAssertEqual(entries.count, 2)

        let serviceNames = entries.map { $0.serviceName }
        XCTAssertTrue(serviceNames.contains("OpenAI"))
        XCTAssertTrue(serviceNames.contains("GitHub"))

        // Entries should never contain plaintext
        for entry in entries {
            XCTAssertFalse(entry.maskedPreview.contains("test"))
        }
    }

    // MARK: - extractStaticPrefix (via applyMask preview)

    func testMaskedPreview_extractsCorrectPrefix() throws {
        try setupDemoMode()
        let (_, key) = try addServiceAndKey(serviceName: "OpenAI", pattern: "sk-proj-[A-Za-z0-9_-]{20,}", showPrefix: 8, value: "sk-proj-test")

        let display = sut.maskedDisplay(keyId: key.id)
        XCTAssertTrue(display.hasPrefix("sk-proj-"))
    }
}
