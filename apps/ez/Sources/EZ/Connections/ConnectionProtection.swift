import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues

struct SharedConnectionSetup: Codable, Identifiable {
    let connectionKey: String
    let accountId: String?
    let active: Bool
    let origin: String
    let operationId: UUID
    let token: UUID
    var id: UUID { token }
    var fence: ConnectionFence { .init(connectionKey: connectionKey, token: token) }
}

@MainActor final class ConnectionSetupHold {
    private var reply: Result<UUID, Error>?
    private var waiter: CheckedContinuation<UUID, Error>?
    private var failure: Error?
    private var operation: Task<Void, Never>?
    private var deadline: Task<Void, Never>?

    func open(
        _ client: SaulConnection, setup: ConnectionSetup, previous: SharedConnectionSetup?
    ) async throws -> ConnectionFence {
        var request: [String: Any] = [
            "action": "connection-setup-hold", "connectionKey": setup.definition.key,
            "operationId": setup.id.uuidString,
        ]
        if let account = setup.definition.accountId { request["accountId"] = account }
        if let token = previous?.token { request["previousToken"] = token.uuidString }
        let operation = Task {
            do {
                _ = try await client.call(
                    request,
                    onEvent: { event in
                        guard event["type"] as? String == "connection-held",
                            let raw = event["token"] as? String, let token = UUID(uuidString: raw),
                            self.reply == nil
                        else { throw EZError("The signed helper did not confirm connection setup.") }
                        self.deadline?.cancel()
                        self.receive(.success(token))
                    })
                throw EZError("Connection protection ended. Review this connection and retry.")
            } catch {
                failure = error
                if reply == nil { receive(.failure(error)) }
            }
        }
        self.operation = operation
        deadline = Task {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            let error = EZError("The signed helper did not confirm connection setup.")
            failure = error
            receive(.failure(error))
            operation.cancel()
        }
        let token = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if let reply { continuation.resume(with: reply) } else { waiter = continuation }
            }
        } onCancel: {
            operation.cancel()
        }
        try Task.checkCancellation()
        return ConnectionFence(connectionKey: setup.definition.key, token: token)
    }

    func check() throws {
        try Task.checkCancellation()
        if let failure { throw failure }
    }

    func close() async {
        deadline?.cancel()
        operation?.cancel()
        await operation?.value
    }

    private func receive(_ reply: Result<UUID, Error>) {
        self.reply = reply
        waiter?.resume(with: reply)
        waiter = nil
    }
}

@MainActor final class ConnectionProtection {
    private let client: SaulConnection
    init(client: SaulConnection) { self.client = client }

    func requireSupport() async throws {
        let reply = try await client.call(["action": "connection-capabilities"])
        guard reply["connectionCoordination"] as? Int == 1 else {
            throw EZError("Update the signed Saul helper before managing shared connections.")
        }
    }

    func reservations() async throws -> [SharedConnectionSetup] {
        let reply = try await client.call(["action": "connection-setups"])
        guard let rows = reply["connectionSetups"] as? [[String: Any]] else {
            throw EZError("Update the signed Saul helper before managing shared connections.")
        }
        return try JSONDecoder().decode(
            [SharedConnectionSetup].self, from: JSONSerialization.data(withJSONObject: rows))
    }

    func reservation(for setup: ConnectionSetup) async throws -> SharedConnectionSetup? {
        try await reservations().first {
            $0.connectionKey == setup.definition.key && $0.operationId == setup.id && $0.origin == "ez"
        }
    }

    func hold(_ setup: ConnectionSetup, resume: Bool) async throws -> (ConnectionSetupHold, ConnectionFence) {
        let previous = resume ? try await reservation(for: setup) : nil
        guard !resume || previous != nil else {
            throw EZError("Connection setup was released. Review the saved connection before starting again.")
        }
        let hold = ConnectionSetupHold()
        do { return (hold, try await hold.open(client, setup: setup, previous: previous)) } catch {
            await hold.close()
            throw error
        }
    }

    func release(_ fence: ConnectionFence) async throws {
        for attempt in 0...2 {
            do {
                _ = try await client.call([
                    "action": "connection-setup-release", "connectionKey": fence.connectionKey,
                    "token": fence.token.uuidString,
                ])
                return
            } catch {
                guard attempt < 2, error.localizedDescription.contains("connection is busy") else {
                    throw error
                }
                try await Task.sleep(for: .milliseconds((attempt + 1) * 40))
            }
        }
    }
}
