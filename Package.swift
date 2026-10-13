// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EZ",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "EZ", targets: ["EZ"])],
    targets: [
        .target(name: "EZCore"),
        .executableTarget(name: "EZ", dependencies: ["EZCore"]),
        .executableTarget(name: "EZChecks", dependencies: ["EZCore"], path: "Tests/EZChecks"),
    ],
    swiftLanguageModes: [.v5]
)
