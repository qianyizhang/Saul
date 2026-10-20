import Foundation
import Network

@MainActor public final class LoopbackListener {
    private var listener: NWListener?
    private var waiter: CheckedContinuation<[String: String], Error>?
    private var ready: CheckedContinuation<URL, Error>?
    private var connections: [NWConnection] = []
    private var expectedState = ""
    private var timer: Task<Void, Never>?
    public init() {}

    public func start(state: String) async throws -> URL {
        expectedState = state
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in self?.accept(connection) }
        }
        return try await withCheckedThrowingContinuation { continuation in
            ready = continuation
            listener.stateUpdateHandler = { [weak self] status in
                Task { @MainActor in
                    guard let self else { return }
                    switch status {
                    case .ready:
                        guard let port = listener.port else {
                            self.cancel()
                            return
                        }
                        let continuation = self.ready
                        self.ready = nil
                        continuation?.resume(
                            returning: URL(string: "http://127.0.0.1:\(port.rawValue)/auth/callback")!)
                    case .failed(let error): self.cancel(error: error)
                    default: break
                    }
                }
            }
            listener.start(queue: .main)
        }
    }
    public func callback() async throws -> [String: String] {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                waiter = continuation
                timer = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: 300_000_000_000) } catch { return }
                    self?.cancel(error: EZError("Sign-in timed out. Please try again."))
                }
            }
        } onCancel: {
            Task { @MainActor in self.cancel() }
        }
    }
    public func cancel(error: Error = CancellationError()) {
        listener?.cancel()
        listener = nil
        timer?.cancel()
        timer = nil
        let ready = ready
        self.ready = nil
        ready?.resume(throwing: error)
        let waiter = waiter
        self.waiter = nil
        waiter?.resume(throwing: error)
        for connection in connections { connection.cancel() }
        connections.removeAll()
    }
    private func accept(_ connection: NWConnection) {
        guard connections.count < 12 else {
            connection.cancel()
            return
        }
        connections.append(connection)
        connection.start(queue: .main)
        receive(connection, accumulated: Data())
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) {
            [weak self] data, _, complete, error in
            Task { @MainActor in
                guard let self else {
                    connection.cancel()
                    return
                }
                let buffer = accumulated + (data ?? Data())
                if buffer.count > 16384 || error != nil {
                    self.close(connection)
                    return
                }
                guard let request = String(data: buffer, encoding: .utf8), request.contains("\r\n\r\n") else {
                    if complete {
                        self.close(connection)
                    } else {
                        self.receive(connection, accumulated: buffer)
                    }
                    return
                }
                do {
                    let values = try Self.parse(request: request, expectedState: self.expectedState)
                    guard self.waiter != nil else { throw EZError("No sign-in pending.") }
                    self.respond(
                        connection, status: "200 OK",
                        body: "Sign-in received. Return to EZ to finish connecting.")
                    self.timer?.cancel()
                    self.timer = nil
                    self.listener?.cancel()
                    self.listener = nil
                    let continuation = self.waiter
                    self.waiter = nil
                    continuation?.resume(returning: values)
                } catch {
                    self.respond(
                        connection, status: "400 Bad Request",
                        body: "Invalid sign-in callback. Return to EZ and try again.")
                }
            }
        }
    }
    public static func parse(request: String, expectedState: String) throws -> [String: String] {
        let first = request.components(separatedBy: "\r\n")[0].split(separator: " ")
        guard first.count == 3, first[0] == "GET", let url = URLComponents(string: String(first[1])),
            url.scheme == nil, url.host == nil, url.path == "/auth/callback"
        else { throw EZError("Invalid callback path.") }
        var values: [String: String] = [:]
        for item in url.queryItems ?? [] {
            guard values[item.name] == nil, let value = item.value else {
                throw EZError("Duplicate or empty callback parameter.")
            }
            values[item.name] = value
        }
        guard values["state"] == expectedState else { throw EZError("Sign-in state mismatch.") }
        return values
    }
    private func respond(_ connection: NWConnection, status: String, body: String) {
        let message =
            "HTTP/1.1 \(status)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n\(body)"
        connection.send(
            content: Data(message.utf8),
            completion: .contentProcessed { [weak self] _ in Task { @MainActor in self?.close(connection) } })
    }
    private func close(_ connection: NWConnection) {
        connection.cancel()
        connections.removeAll { $0 === connection }
    }
}
