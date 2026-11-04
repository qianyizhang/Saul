import Darwin
import EZCore
import Foundation
import SaulCredentialOwner
import SaulCredentialStorage

@main struct SaulCredentialsMain {
    @MainActor static func main() async {
        umask(0o077)
        do {
            let info = Bundle.main.infoDictionary ?? [:]
            let caller = try NativeCaller.authorize(
                arguments: Array(CommandLine.arguments.dropFirst()),
                extensionIDs: info["SaulAllowedExtensionIDs"] as? [String] ?? [])
            let directory = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(
                    "Library/Application Support/Little Clarity/Credentials", isDirectory: true)
            let legacy =
                (info["SaulLegacyAccountsPath"] as? String).map { URL(fileURLWithPath: $0) }
                ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
                    ".saul/chatgpt/accounts.json")
            let storage = SharedAuthStorage(records: KeychainRecords(), directory: directory, legacy: legacy)
            let host = CredentialHost(storage: storage, caller: caller)
            try await host.run()
        } catch {
            // The untrusted/invalid caller receives no credential data or detailed diagnostic context.
            exit(1)
        }
    }
}

@MainActor private final class CredentialHost {
    let storage: SharedAuthStorage
    let caller: CredentialCaller
    var running: [String: Task<Void, Never>] = [:]
    init(storage: SharedAuthStorage, caller: CredentialCaller) {
        self.storage = storage
        self.caller = caller
    }
    func run() async throws {
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            Task.detached {
                do {
                    var frames = NativeFrames()
                    while let data = try NativeFrames.readChunk(from: STDIN_FILENO) {
                        for frame in try frames.append(data) { continuation.yield(frame) }
                    }
                    try frames.requireComplete()
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
        }
        do {
            for try await frame in stream {
                if let cancel = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
                    cancel["cancel"] as? Bool == true, let id = cancel["id"] as? String,
                    Set(cancel.keys).isSubset(of: ["version", "id", "cancel"])
                {
                    running[id]?.cancel()
                    continue
                }
                let request: CredentialRequest
                do { request = try CredentialRequest.decode(frame, caller: caller) } catch {
                    guard let data = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
                        let id = data["id"] as? String, !id.isEmpty, id.utf8.count <= 128
                    else { throw error }
                    send(
                        id: id,
                        event: [
                            "type": "error", "message": "Unsupported or invalid Saul credential operation.",
                        ])
                    continue
                }
                guard running.count < 16, running[request.id] == nil else {
                    send(
                        id: request.id,
                        event: ["type": "error", "message": "Saul credential helper is busy."])
                    continue
                }
                let owner = CredentialOwner(storage: storage, caller: caller) { event in
                    self.send(id: request.id, event: event)
                }
                running[request.id] = Task {
                    let timer = Task {
                        try? await Task.sleep(for: .seconds(request.action == "login" ? 310 : 180))
                        if !Task.isCancelled { self.running[request.id]?.cancel() }
                    }
                    defer {
                        timer.cancel()
                        self.running.removeValue(forKey: request.id)
                    }
                    do { try await owner.run(request) } catch {
                        var reply: [String: Any] = ["type": "error", "message": self.safeMessage(error)]
                        if let error = error as? CredentialHTTPError, let code = error.code,
                            code.range(of: "^[a-z][a-z0-9_]{0,127}$", options: .regularExpression) != nil
                        {
                            reply["reason"] = code
                        }
                        self.send(id: request.id, event: reply)
                    }
                }
            }
        } catch {
            for task in running.values { task.cancel() }
            throw error
        }
        let tasks = Array(running.values)
        for task in tasks { task.cancel() }
        for task in tasks { await task.value }
    }
    private func safeMessage(_ error: Error) -> String {
        if error is CancellationError { return "Saul request stopped or timed out." }
        if let error = error as? CredentialStorageError { return error.localizedDescription }
        if let error = error as? CredentialHTTPError { return error.localizedDescription }
        if let error = error as? APIError {
            return
                "OpenAI request failed (HTTP \(error.status)). Check the Saul connection and retry explicitly."
        }
        return "Saul could not complete this operation. Check the connection or sign in again."
    }
    private func send(id: String, event: [String: Any]) {
        do {
            let reply: [String: Any] = ["id": id, "event": event]
            let data = try JSONSerialization.data(withJSONObject: reply)
            if caller == .saul, data.count > 120_000 {
                // At most 120,000 UTF-16 units / 360,000 escaped bytes per Chrome frame.
                let scalars = Array(String(decoding: data, as: UTF8.self).unicodeScalars)
                var offset = 0
                while offset < scalars.count {
                    let end = min(offset + 60_000, scalars.count)
                    let fragment = String(String.UnicodeScalarView(scalars[offset..<end]))
                    try FileHandle.standardOutput.write(
                        contentsOf: NativeFrames.encode(["fragment": fragment, "last": end == scalars.count]))
                    offset = end
                }
            } else {
                try FileHandle.standardOutput.write(contentsOf: NativeFrames.encode(reply))
            }
        } catch { exit(1) }
    }
}
