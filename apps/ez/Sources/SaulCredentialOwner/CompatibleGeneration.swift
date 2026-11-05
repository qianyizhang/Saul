import Foundation
import SaulCredentialStorage

extension CredentialOwner {
    /// Adapt the existing chat-completions protocol to the native response interface.
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
        var completed = false
        func response(_ event: [String: Any], elapsed: Double) throws {
            let data = try JSONSerialization.data(withJSONObject: event)
            emit([
                "type": "response-event", "data": String(decoding: data, as: UTF8.self), "elapsed": elapsed,
            ])
        }
        try await http.stream(
            route: .chat, body: JSONSerialization.data(withJSONObject: body),
            credential: connection.key, endpoint: connection.endpoint
        ) { data, elapsed in
            if String(data: data, encoding: .utf8) == "[DONE]" {
                guard completed else {
                    throw CredentialStorageError("The endpoint ended before confirming completion.")
                }
                return true
            }
            guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                event["error"] == nil,
                let choice = (event["choices"] as? [[String: Any]])?.first
            else {
                throw CredentialStorageError("The endpoint returned an invalid text event.")
            }
            if let text = (choice["delta"] as? [String: Any])?["content"] as? String {
                try response(["type": "response.output_text.delta", "delta": text], elapsed: elapsed)
            }
            if let reason = choice["finish_reason"] as? String {
                guard reason == "stop" else {
                    throw CredentialStorageError(
                        "The endpoint stopped before completion. Partial output was kept.")
                }
                completed = true
                try response(
                    ["type": "response.completed", "response": ["status": "completed"]], elapsed: elapsed)
            }
            return false
        }
        guard completed else { throw CredentialStorageError("The endpoint disconnected before completion.") }
        emit(["type": "complete"])
    }
}
