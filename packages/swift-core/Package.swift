// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DemoSafe",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "DemoSafe", targets: ["DemoSafe"])
    ],
    dependencies: [
        // WebSocket server — lightweight, pure Swift
    ],
    targets: [
        .executableTarget(
            name: "DemoSafe",
            dependencies: [],
            path: "DemoSafe",
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "DemoSafeTests",
            dependencies: ["DemoSafe"],
            path: "DemoSafeTests"
        )
    ]
)
