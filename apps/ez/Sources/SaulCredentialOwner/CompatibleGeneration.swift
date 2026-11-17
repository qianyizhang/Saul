import Foundation
import SaulCredentialStorage

extension CredentialOwner {
    /// One completion policy for both compatible chat routes. Adapters own their reply envelopes.
    func streamChat(
        _ body: [String: Any], connection: SharedAuthStorage.APIConnection,
        delta: @escaping @MainActor @Sendable (String, Double) throws -> Void
    ) async throws -> Double {
        var answered = false
        var finishedAt: Double?
        try await http.stream(
            route: .chat, body: JSONSerialization.data(withJSONObject: body),
            credential: connection.key, endpoint: connection.endpoint
        ) { data, elapsed in
            let marker = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if marker.isEmpty { return false }
            if marker == "[DONE]" {
                guard answered else {
                    throw CredentialStorageError("The model completed without returning text.")
                }
                finishedAt = elapsed
                return true
            }
            let invalid = CredentialStorageError("The endpoint returned an invalid text event.")
            guard let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                throw invalid
            }
            // Never forward provider error bodies: they may echo the signed owner's key.
            if supplied(event["error"]) {
                throw CredentialStorageError("The provider reported a streaming error.")
            }
            guard let choices = event["choices"] as? [[String: Any]] else { throw invalid }
            if choices.isEmpty, event["usage"] is [String: Any] { return false }
            guard choices.count == 1, let choice = choices.first,
                let value = choice["delta"] as? [String: Any],
                !supplied(value["role"]) || value["role"] is String,
                !supplied(choice["finish_reason"]) || choice["finish_reason"] is String
            else { throw invalid }
            let content = value["content"]
            guard !supplied(content) || content is String,
                !supplied(value["tool_calls"]), !supplied(value["function_call"])
            else {
                throw CredentialStorageError("The endpoint returned non-text content. Choose a text model.")
            }
            if let text = content as? String, !text.isEmpty {
                answered = answered || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                try delta(text, elapsed)
            }
            if let reason = choice["finish_reason"] as? String {
                guard reason == "stop" else {
                    let code =
                        reason.range(of: "^[a-z][a-z0-9_-]{0,63}$", options: .regularExpression) == nil
                        ? "incomplete" : reason
                    throw CredentialStorageError(
                        "The model stopped with \(code). Partial output was retained.")
                }
                finishedAt = elapsed
                return true
            }
            return false
        }
        try Task.checkCancellation()
        guard let finishedAt else {
            throw CredentialStorageError(
                "The connection ended without a completion signal. Retry explicitly.")
        }
        return finishedAt
    }

    /// Adapt Chat Completions to EZ's response accumulator.
    func streamCompatible(_ input: [String: Any], connection: SharedAuthStorage.APIConnection) async throws {
        guard input["tools"] == nil, input["reasoning"] == nil,
            input["service_tier"] == nil || input["service_tier"] as? String == "default"
        else {
            throw CredentialStorageError(
                "This endpoint does not support the preset's search, reasoning or speed options. Update the preset."
            )
        }
        var messages = input["input"] as? [[String: Any]] ?? []
        if let instructions = input["instructions"] as? String, !instructions.isEmpty {
            messages.insert(["role": "system", "content": instructions], at: 0)
        }
        let body: [String: Any] = ["model": input["model"]!, "messages": messages, "stream": true]
        let end = try await streamChat(body, connection: connection) { text, elapsed in
            try self.emitCompatibleResponse(["type": "response.output_text.delta", "delta": text], elapsed)
        }
        try emitCompatibleResponse(["type": "response.completed", "response": ["status": "completed"]], end)
        emit(["type": "complete"])
    }

    private func emitCompatibleResponse(_ event: [String: Any], _ elapsed: Double) throws {
        let data = try JSONSerialization.data(withJSONObject: event)
        emit(["type": "response-event", "data": String(decoding: data, as: UTF8.self), "elapsed": elapsed])
    }
}

private func supplied(_ value: Any?) -> Bool { value != nil && !(value is NSNull) }
