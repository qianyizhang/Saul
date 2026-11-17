// swift-tools-version: 6.0
import PackageDescription

let credentials = Target.Dependency.product(name: "SaulCredentialClient", package: "credentials")
let values = Target.Dependency.product(name: "SaulNativeValues", package: "credentials")
let tests = Target.Dependency.product(name: "SaulTestSupport", package: "credentials")
let ownerTests = Target.Dependency.product(name: "SaulCredentialTestSupport", package: "credentials")

let package = Package(
    name: "EZ",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "EZ", targets: ["EZ"])],
    dependencies: [.package(path: "../../native/credentials")],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(
            name: "EZCore", dependencies: ["CSQLite", values, credentials],
            resources: [.copy("Resources/history.sql")]),
        .target(name: "EZApplication", dependencies: ["EZCore", credentials, values], path: "Sources/EZ"),
        .executableTarget(name: "EZ", dependencies: ["EZApplication"], path: "Sources/EZEntry"),
        .executableTarget(
            name: "EZStateChecks",
            dependencies: ["EZApplication", "EZCore", "EZCheckSupport", values, credentials, tests],
            path: "Tests/EZStateChecks"),
        .target(name: "EZCheckSupport", dependencies: ["CSQLite", tests], path: "Tests/Support"),
        .executableTarget(
            name: "EZChecks",
            dependencies: ["EZCore", "EZCheckSupport", values, credentials, tests, ownerTests],
            path: "Tests/EZChecks"),
    ],
    swiftLanguageModes: [.v5]
)
