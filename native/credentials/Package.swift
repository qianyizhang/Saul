// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "SaulCredentials",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "SaulNativeValues", targets: ["SaulNativeValues"]),
    .library(name: "SaulCredentialClient", targets: ["SaulCredentialClient"]),
    .executable(name: "SaulCredentials", targets: ["SaulCredentials"]),
    .library(name: "SaulTestSupport", targets: ["SaulTestSupport"]),
    .library(name: "SaulCredentialTestSupport", targets: ["SaulCredentialTestSupport"]),
  ],
  targets: [
    .target(name: "SaulNativeValues"),
    .target(name: "SaulCredentialClient"),
    .target(
      name: "SaulCredentialOwner", dependencies: ["SaulNativeValues", "SaulCredentialClient"]),
    .executableTarget(
      name: "SaulCredentials",
      dependencies: ["SaulCredentialOwner", "SaulNativeValues", "SaulCredentialClient"]),
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
        "SaulCredentialClient", "SaulTestSupport",
      ],
      path: "Tests/CredentialOwnerChecks"),
  ],
  swiftLanguageModes: [.v5]
)
