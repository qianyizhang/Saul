// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "SaulCredentials",
  platforms: [.macOS(.v14)],
  products: [.library(name: "SaulCredentialStorage", targets: ["SaulCredentialStorage"])],
  targets: [
    .target(name: "SaulCredentialStorage"),
    .executableTarget(name: "CredentialChecks", dependencies: ["SaulCredentialStorage"]),
  ],
  swiftLanguageModes: [.v5]
)
