import EZCheckSupport
import EZCore
import Foundation
import SaulCredentialStorage

@MainActor func providerChecks() -> [CheckCase] {
    [
        CheckCase("providers: plan rejects image and search before contacting the owner") { directory in
            let fixture = HTTPFixture { _ in throw CheckFailure("Unsupported operation reached HTTP") }
            defer { fixture.close() }
            let provider = try credentialProvider(directory: directory, http: fixture, id: .chatGPTPlan)
            try await expectAsyncThrows(EZError.self) {
                _ = try await provider.generateImage(ImageGenerationRequest(prompt: "Tree"))
            }
            var entry = HistoryEntry(
                mode: .ask, query: "Hi", model: "test", effort: "", requestedServiceTier: nil)
            entry.actionSnapshot = Action(
                name: "Search", presetID: UUID(), template: "{{text}}", webSearch: true)
            try await expectAsyncThrows(EZError.self) {
                _ = try await provider.streamText(entry: entry) { _ in }
            }
            try expectEqual(fixture.requests.count, 0, "Unsupported operation reached provider")
        },
        CheckCase("providers: missing shared API key blocks without an HTTP fallback") { directory in
            let fixture = HTTPFixture { _ in throw CheckFailure("Unconfigured provider reached HTTP") }
            defer { fixture.close() }
            let provider = try credentialProvider(directory: directory, http: fixture, key: nil)
            var entry = HistoryEntry(
                mode: .ask, query: "Hi", model: "test", effort: "", requestedServiceTier: nil)
            entry.providerSnapshot = ProviderDefinition.defaults[1]
            try await expectAsyncThrows(CredentialStorageError.self) {
                _ = try await provider.streamText(entry: entry) { _ in }
            }
            try expectEqual(fixture.requests.count, 0, "Missing key sent a request")
        },
    ]
}
