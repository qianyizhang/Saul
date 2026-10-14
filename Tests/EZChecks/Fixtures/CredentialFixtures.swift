import EZCheckSupport
import Foundation

@testable import EZCore

final class MemoryCredentials: CredentialStore {
    private(set) var value: AuthState
    private(set) var writes = 0
    var failReads = false
    var failWrites = false
    init(_ value: AuthState = AuthState()) { self.value = value }
    func read() throws -> AuthState {
        if failReads { throw EZError("Synthetic credential read failure") }
        return value
    }
    func write(_ state: AuthState) throws {
        if failWrites { throw EZError("Synthetic credential write failure") }
        writes += 1
        value = state
    }
}

actor PendingCredentialRead {
    let started = CheckSignal()
    private var pending: CheckedContinuation<AuthState, Never>?
    func read() async -> AuthState {
        await withCheckedContinuation {
            pending = $0
            Task { await started.signal() }
        }
    }
    func finish(_ state: AuthState) {
        pending?.resume(returning: state)
        pending = nil
    }
}

struct DeferredCredentials: CredentialStore {
    let pending: PendingCredentialRead
    func read() async throws -> AuthState { await pending.read() }
    func write(_ state: AuthState) throws { throw EZError("Read-only credential fixture") }
}

func credentialState(scopes: [String] = ["openid", "chatgpt.tokens.use.direct"]) -> AuthState {
    var state = AuthState()
    state.profiles = [
        AccountProfile(
            clientID: "issued", subject: "subject", email: "test@example.invalid",
            credentials: Credentials(
                accessToken: "old", refreshToken: "refresh", idToken: "old-id", expiresAt: .distantPast,
                scopes: scopes))
    ]
    state.selectedID = "issued"
    return state
}

let refreshReply =
    #"{"access_token":"new","refresh_token":"rotated","token_type":"Bearer","expires_in":3600}"#

func credentialBytes(_ state: AuthState) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(state)
}
