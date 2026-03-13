import Foundation
import Security

/// Pure Keychain CRUD — the ONLY module that touches plaintext keys.
///
/// All keys are stored under the service prefix `com.demosafe.key.{UUID}`
/// with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` protection.
final class KeychainService {
    private let servicePrefix = "com.demosafe.key"

    enum KeychainError: Error, LocalizedError {
        case itemNotFound
        case duplicateItem
        case authFailed
        case unexpected(OSStatus)

        var errorDescription: String? {
            switch self {
            case .itemNotFound:
                return "Keychain item not found"
            case .duplicateItem:
                return "Keychain item already exists"
            case .authFailed:
                return "Keychain authentication failed (device locked or Touch ID denied)"
            case .unexpected(let status):
                return "Keychain error: \(status)"
            }
        }
    }

    // MARK: - Public API

    /// Store a key's plaintext value in Keychain.
    /// - Parameters:
    ///   - keyId: Unique identifier for the key
    ///   - value: Plaintext key data to store
    /// - Throws: `KeychainError.duplicateItem` if keyId already exists
    func storeKey(keyId: UUID, value: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: keyId),
            kSecAttrAccount as String: keyId.uuidString,
            kSecValueData as String: value,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        switch status {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            throw KeychainError.duplicateItem
        default:
            throw KeychainError.unexpected(status)
        }
    }

    /// Retrieve a key's plaintext value from Keychain.
    /// - Parameter keyId: Unique identifier for the key
    /// - Returns: The plaintext key data
    /// - Throws: `KeychainError.itemNotFound` if keyId doesn't exist
    func retrieveKey(keyId: UUID) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: keyId),
            kSecAttrAccount as String: keyId.uuidString,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            guard let data = result as? Data else {
                throw KeychainError.unexpected(errSecInternalError)
            }
            return data
        case errSecItemNotFound:
            throw KeychainError.itemNotFound
        case errSecAuthFailed, errSecUserCanceled, errSecInteractionNotAllowed:
            throw KeychainError.authFailed
        default:
            throw KeychainError.unexpected(status)
        }
    }

    /// Delete a key from Keychain.
    /// - Parameter keyId: Unique identifier for the key
    /// - Throws: `KeychainError.itemNotFound` if keyId doesn't exist
    func deleteKey(keyId: UUID) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: keyId),
            kSecAttrAccount as String: keyId.uuidString,
        ]

        let status = SecItemDelete(query as CFDictionary)

        switch status {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            throw KeychainError.itemNotFound
        default:
            throw KeychainError.unexpected(status)
        }
    }

    /// Update an existing key's plaintext value in Keychain.
    /// - Parameters:
    ///   - keyId: Unique identifier for the key
    ///   - newValue: New plaintext key data
    /// - Throws: `KeychainError.itemNotFound` if keyId doesn't exist
    func updateKey(keyId: UUID, newValue: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: keyId),
            kSecAttrAccount as String: keyId.uuidString,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: newValue,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        switch status {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            throw KeychainError.itemNotFound
        default:
            throw KeychainError.unexpected(status)
        }
    }

    /// Check if a key exists in Keychain without retrieving its value.
    func keyExists(keyId: UUID) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: keyId),
            kSecAttrAccount as String: keyId.uuidString,
            kSecReturnData as String: false,
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    // MARK: - Private

    private func serviceName(for keyId: UUID) -> String {
        return "\(servicePrefix).\(keyId.uuidString)"
    }
}
