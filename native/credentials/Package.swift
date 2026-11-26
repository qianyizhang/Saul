// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "SaulCredentials",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "CSQLite", targets: ["CSQLite"]),
    .library(name: "SaulConnectionCoordination", targets: ["SaulConnectionCoordination"]),
    .library(name: "SaulNativeValues", targets: ["SaulNativeValues"]),
    .library(name: "SaulCredentialClient", targets: ["SaulCredentialClient"]),
    .executable(name: "SaulCredentials", targets: ["SaulCredentials"]),
    .library(name: "SaulTestSupport", targets: ["SaulTestSupport"]),
    .library(name: "SaulCredentialTestSupport", targets: ["SaulCredentialTestSupport"]),
  ],
  targets: [
    .systemLibrary(name: "CSQLite"),
    .target(name: "SaulNativeValues"),
    .target(name: "SaulConnectionCoordination", dependencies: ["CSQLite", "SaulNativeValues"]),
    .target(name: "SaulCredentialClient"),
    .target(
      name: "SaulCredentialOwner",
      dependencies: ["SaulNativeValues", "SaulCredentialClient", "SaulConnectionCoordination"]),
    .executableTarget(
      name: "SaulCredentials",
      dependencies: [
        "SaulCredentialOwner", "SaulNativeValues", "SaulCredentialClient",
        "SaulConnectionCoordination",
      ]),
    .target(name: "SaulTestSupport", path: "Tests/Support"),
    .target(
      name: "SaulCredentialTestSupport",
      dependencies: [
        "SaulCredentialOwner", "SaulNativeValues", "SaulCredentialClient", "SaulTestSupport",
      ],
      path: "Tests/OwnerSupport"),
    .executableTarget(
      name: "CredentialChecks", dependencies: ["SaulCredentialClient", "SaulCredentialOwner"],
      path: "Tests/CredentialChecks"),
    .executableTarget(
      name: "CredentialOwnerChecks",
      dependencies: [
        "SaulCredentialTestSupport", "SaulCredentialOwner", "SaulNativeValues",
        "SaulCredentialClient", "SaulTestSupport", "SaulConnectionCoordination",
      ],
      path: "Tests/CredentialOwnerChecks"),
  ],
  swiftLanguageModes: [.v5]
)
