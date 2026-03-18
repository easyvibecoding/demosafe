import Foundation
import os

private let logger = Logger(subsystem: "com.demosafe", category: "NMHInstaller")

/// Installs the Native Messaging Host binary and Chrome manifest on app launch.
/// Copies from app bundle Resources → ~/.demosafe/bin/ and writes the Chrome NMH manifest.
enum NMHInstaller {

    private static let binaryName = "demosafe-nmh"
    private static let hostName = "com.demosafe.nmh"
    private static let installDir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".demosafe/bin")
    private static let chromeNMHDir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts")

    /// Check and install NMH if needed. Call from AppState.init().
    static func installIfNeeded(extensionId: String) {
        let binaryDest = installDir.appendingPathComponent(binaryName)
        let manifestDest = chromeNMHDir.appendingPathComponent("\(hostName).json")

        let fm = FileManager.default

        // Check if binary exists in app bundle Resources
        guard let bundledBinary = Bundle.main.url(forResource: binaryName, withExtension: nil) else {
            logger.warning("NMH binary not found in app bundle Resources, skipping auto-install")
            return
        }

        // Check if binary needs updating (missing or different size)
        let needsBinaryUpdate: Bool
        if fm.fileExists(atPath: binaryDest.path) {
            let bundledSize = (try? fm.attributesOfItem(atPath: bundledBinary.path)[.size] as? Int) ?? 0
            let installedSize = (try? fm.attributesOfItem(atPath: binaryDest.path)[.size] as? Int) ?? -1
            needsBinaryUpdate = bundledSize != installedSize
        } else {
            needsBinaryUpdate = true
        }

        // Install binary if needed
        if needsBinaryUpdate {
            do {
                try fm.createDirectory(at: installDir, withIntermediateDirectories: true)
                if fm.fileExists(atPath: binaryDest.path) {
                    try fm.removeItem(at: binaryDest)
                }
                try fm.copyItem(at: bundledBinary, to: binaryDest)
                // chmod 755
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryDest.path)
                logger.info("NMH binary installed: \(binaryDest.path)")
            } catch {
                logger.error("Failed to install NMH binary: \(error)")
                return
            }
        }

        // Check if manifest needs updating
        let needsManifestUpdate: Bool
        if fm.fileExists(atPath: manifestDest.path),
           let existingData = try? Data(contentsOf: manifestDest),
           let existing = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any],
           let origins = existing["allowed_origins"] as? [String],
           origins.contains("chrome-extension://\(extensionId)/"),
           existing["path"] as? String == binaryDest.path {
            needsManifestUpdate = false
        } else {
            needsManifestUpdate = true
        }

        // Write manifest if needed
        if needsManifestUpdate {
            do {
                try fm.createDirectory(at: chromeNMHDir, withIntermediateDirectories: true)

                let manifest: [String: Any] = [
                    "name": hostName,
                    "description": "DemoSafe Native Messaging Host — relay for Chrome Extension",
                    "path": binaryDest.path,
                    "type": "stdio",
                    "allowed_origins": ["chrome-extension://\(extensionId)/"],
                ]

                let data = try JSONSerialization.data(withJSONObject: manifest, options: .prettyPrinted)
                try data.write(to: manifestDest)
                logger.info("NMH manifest installed: \(manifestDest.path)")
            } catch {
                logger.error("Failed to install NMH manifest: \(error)")
                return
            }
        }

        if !needsBinaryUpdate && !needsManifestUpdate {
            logger.info("NMH already installed and up to date")
        }
    }
}
