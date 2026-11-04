// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EZ",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "EZ", targets: ["EZ"]),
        .executable(name: "SaulCredentials", targets: ["SaulCredentials"]),
    ],
    dependencies: [.package(path: "../../native/credentials")],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(
            name: "EZCore",
            dependencies: ["CSQLite", .product(name: "SaulCredentialStorage", package: "credentials")],
            resources: [.copy("Resources/history.sql")]),
        .executableTarget(
            name: "EZ",
            dependencies: ["EZCore", .product(name: "SaulCredentialStorage", package: "credentials")]),
        .executableTarget(
            name: "SaulCredentials",
            dependencies: [
                "EZCore", "SaulCredentialOwner",
                .product(name: "SaulCredentialStorage", package: "credentials"),
            ]),
        .target(
            name: "SaulCredentialOwner",
            dependencies: ["EZCore", .product(name: "SaulCredentialStorage", package: "credentials")]),
        .executableTarget(
            name: "CredentialOwnerChecks",
            dependencies: [
                "SaulCredentialOwner", "EZCore",
                .product(name: "SaulCredentialStorage", package: "credentials"),
            ], path: "Tests/CredentialOwnerChecks"),
        .target(name: "EZCheckSupport", dependencies: ["CSQLite"], path: "Tests/Support"),
        .executableTarget(
            name: "EZChecks", dependencies: ["EZCore", "EZCheckSupport", "SaulCredentialOwner"],
            path: "Tests/EZChecks"),
    ],
    swiftLanguageModes: [.v5]
)
