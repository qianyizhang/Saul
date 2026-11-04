import EZCore
import Foundation
import SaulCredentialStorage

@MainActor package final class CredentialOwner {
    let storage: SharedAuthStorage
    let http: OfficialOpenAI
    let caller: CredentialCaller
    let emit: ([String: Any]) -> Void
    private var catalogs: [String: [ModelOption]] = [:]
    package init(
        storage: SharedAuthStorage, caller: CredentialCaller, http: OfficialOpenAI = OfficialOpenAI(),
        emit: @escaping ([String: Any]) -> Void
    ) {
        self.storage = storage
        self.caller = caller
        self.emit = emit
        self.http = http
    }
    private func locked<T>(_ operation: (ChatGPTAuth) async throws -> T) async throws -> T {
        let lease = try await CredentialLease.acquire(in: storage.directory)
        defer { withExtendedLifetime(lease) {} }
        let auth = ChatGPTAuth(storage: storage)
        try await auth.load()
        return try await operation(auth)
    }
    private func summary(_ profile: AccountProfile) -> [String: Any] {
        [
            "id": profile.id, "label": profile.label, "signedIn": profile.credentials != nil,
            "planEnabled": profile.credentials?.canUsePlan == true,
        ]
    }
    private func status(_ auth: ChatGPTAuth) throws -> [String: Any] {
        var result: [String: Any] = [
            "type": "result", "accounts": auth.state.profiles.map(summary),
            "apiConnected": try storage.records.contains(.openAI),
        ]
        if let selected = auth.state.selectedID { result["selectedAccountId"] = selected }
        return result
    }
    private func token(accountID: String, allowPaused: Bool = false) async throws -> String {
        try await locked { auth in
            guard try allowPaused || !self.storage.isPaused(accountID) else {
                throw CredentialStorageError(
                    "ChatGPT plan requests are paused after a usage limit. Refresh models before retrying.")
            }
            return try await auth.accessToken(accountID: accountID)
        }
    }
    private func apiKey() async throws -> String {
        let lease = try await CredentialLease.acquire(in: storage.directory)
        defer { withExtendedLifetime(lease) {} }
        return try storage.apiKey()
    }
    package func run(_ request: CredentialRequest) async throws {
        let value = request.value
        func result(_ value: [String: Any] = [:]) {
            emit(value.merging(["type": "result"]) { _, new in new })
        }
        switch request.action {
        case "status", "accounts":
            emit(try await locked { try self.status($0) })
        case "select":
            emit(
                try await locked { auth in
                    try auth.select((value["accountId"] as? String ?? ""))
                    return try self.status(auth)
                })
        case "login":
            emit(
                try await locked { auth in
                    if let id = value["accountId"] as? String { try auth.select(id) }
                    try await auth.signIn(
                        newAccount: value["accountId"] == nil, enablePlan: value["consent"] as? Bool == true
                    ) { url in
                        self.emit(["type": "authorize", "url": url.absoluteString])
                        return true
                    }
                    guard let account = auth.selected else {
                        throw CredentialStorageError("Saul sign-in did not select an account.")
                    }
                    self.catalogs.removeValue(forKey: account.id)
                    try self.storage.pause(account.id, value: false)
                    return ["type": "result", "account": self.summary(account)]
                })
        case "logout":
            emit(
                try await locked { auth in
                    try auth.select((value["accountId"] as? String ?? ""))
                    let warning = try await auth.signOut()
                    guard let profile = auth.selected else {
                        throw CredentialStorageError("Choose a Saul account.")
                    }
                    self.catalogs.removeValue(forKey: profile.id)
                    var result: [String: Any] = ["type": "result", "account": self.summary(profile)]
                    if let warning { result["warning"] = warning }
                    return result
                })
        case "models":
            let id = (value["accountId"] as? String ?? "")
            let token = try await token(accountID: id, allowPaused: true)
            let models = try await loadModels(accountID: id, token: token)
            _ = try await locked { _ in try self.storage.pause(id, value: false) }
            result(["models": models.map(catalogSummary)])
        case "generate":
            let id = (value["accountId"] as? String ?? "")
            let token = try await token(accountID: id)
            let models = try await catalog(accountID: id, token: token)
            let tier = try validateModel(
                (value["model"] as? String ?? ""), effort: value["effort"] as? String,
                fast: value["fast"] as? Bool == true, models: models)
            var content: Any = (value["userPrompt"] as? String ?? "")
            if let attachments = value["attachments"] as? [[String: Any]] {
                content =
                    [["type": "input_text", "text": (value["userPrompt"] as? String ?? "")]]
                    + attachments.map { ["type": "input_file", "file_url": ($0["url"] as? String ?? "")] }
            }
            var body: [String: Any] = [
                "model": value["model"]!, "instructions": value["systemPrompt"]!,
                "input": [["role": "user", "content": content]], "store": false, "stream": true,
                "service_tier": tier,
            ]
            if let effort = value["effort"] as? String, !effort.isEmpty {
                body["reasoning"] = ["effort": effort]
            }
            try await streamResponses(body, token: token, accountID: id, native: false)
        case "api-key-status":
            let lease = try await CredentialLease.acquire(in: storage.directory)
            defer { withExtendedLifetime(lease) {} }
            result([
                "apiConnected": try storage.records.contains(.openAI),
                "retired": try storage.migrationCompleted(),
            ])
        case "api-key-save", "api-key-remove", "api-key-import":
            let lease = try await CredentialLease.acquire(in: storage.directory)
            defer { withExtendedLifetime(lease) {} }
            if request.action == "api-key-import" {
                try storage.importKey((value["key"] as? String ?? ""))
            } else {
                try storage.saveKey(value["key"] as? String)
            }
            if let selected = value["selectedAccountId"] as? String {
                let auth = ChatGPTAuth(storage: storage)
                try await auth.load()
                if auth.state.profiles.contains(where: { $0.id == selected }) { try auth.select(selected) }
            }
            result(["apiConnected": try storage.records.contains(.openAI)])
        case "api-chat":
            let key = try await apiKey()
            let body: [String: Any] = [
                "model": value["model"]!,
                "messages": [
                    ["role": "system", "content": value["systemPrompt"]!],
                    ["role": "user", "content": value["userPrompt"]!],
                ],
                "temperature": value["temperature"] ?? 0.3, "max_tokens": value["maxTokens"] ?? 1024,
                "stream": true,
            ]
            var finished = false
            try await http.stream(
                route: .chat, body: JSONSerialization.data(withJSONObject: body), credential: key
            ) { data, _ in
                if String(data: data, encoding: .utf8) == "[DONE]" {
                    finished = true
                    return true
                }
                guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                    event["error"] == nil,
                    let choice = (event["choices"] as? [[String: Any]])?.first
                else { throw CredentialStorageError("OpenAI returned an invalid text event.") }
                if let text = (choice["delta"] as? [String: Any])?["content"] {
                    guard let text = text as? String else {
                        throw CredentialStorageError("Choose a text model.")
                    }
                    if !text.isEmpty { self.emit(["type": "delta", "text": text]) }
                }
                if let reason = choice["finish_reason"] as? String {
                    guard reason == "stop" else {
                        throw CredentialStorageError(
                            "OpenAI stopped with \(reason). The partial answer was retained.")
                    }
                    finished = true
                }
                return false
            }
            guard finished else {
                throw CredentialStorageError("OpenAI disconnected before text completed. Retry explicitly.")
            }
            emit(["type": "complete"])
        case "api-realtime":
            let key = try await apiKey()
            let body: [String: Any] = [
                "session": [
                    "type": "realtime", "model": value["model"]!, "output_modalities": ["audio"],
                    "audio": [
                        "input": ["turn_detection": NSNull()],
                        "output": [
                            "voice": value["voice"]!, "format": ["type": "audio/pcm", "rate": 24000],
                        ],
                    ],
                    "tools": [], "max_output_tokens": 2048,
                ]
            ]
            let secret = try await http.json(
                route: .realtime, body: JSONSerialization.data(withJSONObject: body), credential: key)
            guard let secret = secret["value"] as? String,
                secret.range(of: "^[A-Za-z0-9_-]{1,4096}$", options: .regularExpression) != nil
            else {
                throw CredentialStorageError("OpenAI returned an invalid Realtime client secret.")
            }
            result(["clientSecret": secret])
        case "native-responses":
            let body = (value["body"] as? [String: Any] ?? [:])
            let plan = value["provider"] as? String == "chatgpt-plan"
            let id = value["accountId"] as? String
            let credential: String
            if plan { credential = try await token(accountID: id!) } else { credential = try await apiKey() }
            if plan {
                let models = try await catalog(accountID: id!, token: credential)
                let effort = (body["reasoning"] as? [String: Any])?["effort"] as? String
                let tier = body["service_tier"] as? String ?? "default"
                let advertisedTier = try validateModel(
                    (body["model"] as? String ?? ""), effort: effort, fast: tier != "default", models: models)
                guard advertisedTier == tier else {
                    throw CredentialStorageError(
                        "The requested ChatGPT service tier is unavailable. Refresh models.")
                }
            }
            try await streamResponses(body, token: credential, accountID: plan ? id : nil, native: true)
        case "native-image":
            let key = try await apiKey()
            var image: ImageAttachment?
            if let encoded = value["imageBase64"] as? String {
                guard let data = Data(base64Encoded: encoded) else {
                    throw CredentialStorageError("The image attachment is invalid.")
                }
                image = try ImageAttachment(data: data, name: value["imageName"] as? String ?? "input")
            }
            let data = try await ImagesClient().generate(
                ImageGenerationRequest(
                    prompt: (value["prompt"] as? String ?? ""),
                    model: (value["model"] as? String ?? ""), size: (value["size"] as? String ?? ""),
                    quality: (value["quality"] as? String ?? ""), image: image), apiKey: key)
            result(["imageBase64": data.base64EncodedString()])
        case "migration-verified":
            if try storage.migrationCompleted() {
                result(["retired": true])
            } else {
                result([
                    "retired": try await locked { _ in try self.storage.verifyMigration(for: self.caller) }
                ])
            }
        default: throw CredentialStorageError("Unsupported Saul operation.")
        }
    }
    private func loadModels(accountID: String, token: String) async throws -> [ModelOption] {
        let response = try await http.json(route: .models, credential: token)
        guard let raw = response["models"] as? [[String: Any]] else {
            throw CredentialStorageError("OpenAI returned an invalid model catalog.")
        }
        let models = raw.compactMap(ModelOption.init(catalog:))
        guard !models.isEmpty else {
            throw CredentialStorageError("No models are available for this ChatGPT account.")
        }
        catalogs[accountID] = models
        return models
    }
    private func catalog(accountID: String, token: String) async throws -> [ModelOption] {
        if let models = catalogs[accountID] { return models }
        return try await loadModels(accountID: accountID, token: token)
    }
    private func validateModel(_ model: String, effort: String?, fast: Bool, models: [ModelOption]) throws
        -> String
    {
        guard let option = models.first(where: { $0.model == model }) else {
            throw CredentialStorageError("The chosen ChatGPT model is unavailable. Refresh models.")
        }
        if let effort, !effort.isEmpty,
            !option.supportedReasoningEfforts.contains(where: { $0.reasoningEffort == effort })
        {
            throw CredentialStorageError("The chosen reasoning effort is unavailable. Refresh models.")
        }
        guard !fast || option.fastTier != nil else {
            throw CredentialStorageError("Fast is unavailable for this ChatGPT model.")
        }
        let tier = fast ? option.fastTier! : "default"
        return tier == "fast" ? "priority" : tier
    }
    private func catalogSummary(_ model: ModelOption) -> [String: Any] {
        var value: [String: Any] = [
            "slug": model.model, "display_name": model.displayName,
            "defaultReasoningEffort": model.defaultReasoningEffort, "isDefault": model.isDefault,
            "supportedReasoningEfforts": model.supportedReasoningEfforts.map {
                ["effort": $0.reasoningEffort, "description": $0.description]
            },
        ]
        if let fast = model.fastTier { value["fastTier"] = fast }
        return value
    }
    private func streamResponses(_ body: [String: Any], token: String, accountID: String?, native: Bool)
        async throws
    {
        var complete = false
        try await http.stream(
            route: .responses, body: JSONSerialization.data(withJSONObject: body), credential: token
        ) { data, elapsed in
            if String(data: data, encoding: .utf8) == "[DONE]" { return true }
            guard var event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let type = event["type"] as? String
            else {
                throw CredentialStorageError("OpenAI returned an invalid response event.")
            }
            if ["response.failed", "response.incomplete", "error"].contains(type) {
                let response = event["response"] as? [String: Any]
                let error = response?["error"] as? [String: Any] ?? event["error"] as? [String: Any]
                let code = (error?["code"] as? String).flatMap {
                    $0.range(of: "^[a-z][a-z0-9_]{0,127}$", options: .regularExpression) == nil ? nil : $0
                }
                if let accountID,
                    ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable"]
                        .contains(code)
                {
                    _ = try await self.locked { _ in try self.storage.pause(accountID, value: true) }
                }
                if native {
                    let safe: [String: Any] = [
                        "code": code ?? "request_failed", "message": "OpenAI did not complete the response.",
                    ]
                    if var response {
                        response["error"] = safe
                        event["response"] = response
                    } else {
                        event["error"] = safe
                    }
                    self.emit([
                        "type": "response-event",
                        "data": String(
                            decoding: try JSONSerialization.data(withJSONObject: event), as: UTF8.self),
                        "elapsed": elapsed,
                    ])
                }
                throw CredentialHTTPError(status: 0, code: code)
            }
            if native {
                self.emit([
                    "type": "response-event", "data": String(decoding: data, as: UTF8.self),
                    "elapsed": elapsed,
                ])
            } else {
                if type == "response.output_item.added",
                    (event["item"] as? [String: Any])?["type"] as? String == "reasoning"
                {
                    self.emit(["type": "activity", "phase": "thinking"])
                }
                if ["response.output_text.delta", "response.refusal.delta"].contains(type),
                    let delta = event["delta"] as? String, !delta.isEmpty
                {
                    self.emit(["type": "delta", "text": delta])
                }
            }
            if type == "response.completed" {
                guard (event["response"] as? [String: Any])?["status"] as? String == "completed" else {
                    throw CredentialStorageError("OpenAI did not complete the response.")
                }
                complete = true
                return true
            }
            return false
        }
        guard complete else {
            throw CredentialStorageError("OpenAI disconnected before response.completed. Retry explicitly.")
        }
        emit(["type": "complete"])
    }
}
