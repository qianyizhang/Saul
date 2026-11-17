import EZCore
import Foundation
import SaulCredentialStorage

@MainActor package final class CredentialOwner {
    let storage: SharedAuthStorage
    let http: ConnectionHTTP
    let emit: ([String: Any]) -> Void
    let connectionDefinitions: () throws -> [ConnectionDefinition]
    package init(
        storage: SharedAuthStorage, http: ConnectionHTTP = ConnectionHTTP(),
        connectionDefinitions: @escaping () throws -> [ConnectionDefinition] = {
            try SharedPresetsStore().read().connections
        },
        emit: @escaping ([String: Any]) -> Void
    ) {
        self.storage = storage
        self.emit = emit
        self.connectionDefinitions = connectionDefinitions
        self.http = http
    }
    func withLease<T>(_ operation: () async throws -> T) async throws -> T {
        let lease = try await CredentialLease.acquire(in: storage.directory)
        defer { withExtendedLifetime(lease) {} }
        try Task.checkCancellation()
        return try await operation()
    }
    private func locked<T>(_ operation: (ChatGPTAuth) async throws -> T) async throws -> T {
        try await withLease {
            let auth = ChatGPTAuth(storage: storage)
            try await auth.load()
            return try await operation(auth)
        }
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
    private func apiConnection(_ value: [String: Any], officialOnly: Bool = false) async throws
        -> SharedAuthStorage.APIConnection
    {
        let model = value["model"] as? String ?? (value["body"] as? [String: Any])?["model"] as? String ?? ""
        return try await apiAdmission(
            connectionKey: value["connectionKey"] as? String, model: model, officialOnly: officialOnly)
    }
    package func run(_ request: CredentialRequest) async throws {
        do { try await execute(request) } catch {
            if let failure = error as? CredentialHTTPError, failure.code == "model_not_found" {
                try Task.checkCancellation()
                let key = request.value["connectionKey"] as? String
                if let accountID = request.value["accountId"] as? String,
                    request.action == "generate" || request.value["provider"] as? String == "chatgpt-plan"
                {
                    _ = try? await planCatalog(accountID: accountID, connectionKey: key, intent: .refresh)
                } else if let key {
                    _ = try? await connectionCatalog(key, intent: .refresh)
                }
                try Task.checkCancellation()
                throw CredentialStorageError(
                    "The selected model is unavailable. Update its preset in Settings.")
            }
            throw error
        }
    }
    package static func planContent(_ value: [String: Any]) -> Any {
        let text = value["userPrompt"] as? String ?? ""
        let attachments = value["attachments"] as? [[String: Any]] ?? []
        let images = value["images"] as? [String] ?? []
        guard !attachments.isEmpty || !images.isEmpty else { return text }
        return [["type": "input_text", "text": text]]
            + images.map { ["type": "input_image", "image_url": $0, "detail": "auto"] }
            + attachments.map { ["type": "input_file", "file_url": $0["url"] as? String ?? ""] }
    }
    private func execute(_ request: CredentialRequest) async throws {
        let value = request.value
        func result(_ value: [String: Any] = [:]) {
            emit(value.merging(["type": "result"]) { _, new in new })
        }
        switch request.action {
        case "connection-status":
            let status: [String: Any] = try await withLease {
                let definition = try connectionDefinition(value["connectionKey"] as? String ?? "")
                guard definition.kind == .chatGPTPlan else {
                    let status = try storage.connectionStatus(definition.key)
                    if let endpoint = status["endpoint"] as? String, endpoint != definition.endpoint {
                        throw CredentialStorageError(
                            "This connection's endpoint changed. Add a new connection.")
                    }
                    return status
                }
                let auth = ChatGPTAuth(storage: storage)
                try await auth.load()
                guard let id = definition.accountId,
                    let account = auth.state.profiles.first(where: { $0.id == id })
                else { return ["connected": false, "identity": "Choose an account"] }
                return [
                    "connected": account.credentials?.canUsePlan == true,
                    "identity": account.email ?? "Signed-in account",
                    "signedIn": account.credentials != nil,
                ]
            }
            result(["connection": status])
        case "connection-catalog":
            let intent = request.catalogIntent ?? (value["force"] as? Bool == true ? .refresh : .display)
            var catalog = try await connectionCatalog(value["connectionKey"] as? String ?? "", intent: intent)
            if request.catalogIntent == nil {
                for index in catalog.models.indices { catalog.models[index].isDefault = nil }
            }
            result(["catalog": try JSONSerialization.jsonObject(with: JSONEncoder().encode(catalog))])
        case "connection-key-save", "connection-key-remove":
            let status = try await withLease {
                let id = value["connectionKey"] as? String ?? ""
                let saving = request.action == "connection-key-save"
                if saving { try invalidateAPICatalog(id) }
                try storage.saveConnectionKey(
                    id, endpoint: value["endpoint"] as? String ?? "",
                    key: saving ? value["key"] as? String : nil)
                if !saving { try? invalidateAPICatalog(id) }
                return try storage.connectionStatus(id)
            }
            result(["connection": status])
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
                    if let id = value["accountId"] as? String {
                        try self.invalidatePlanCatalog(id)
                        try auth.select(id)
                    }
                    try await auth.signIn(
                        newAccount: value["accountId"] == nil, enablePlan: value["consent"] as? Bool == true
                    ) { url in
                        self.emit(["type": "authorize", "url": url.absoluteString])
                        return true
                    }
                    guard let account = auth.selected else {
                        throw CredentialStorageError("Saul sign-in did not select an account.")
                    }
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
                    // A damaged discovery cache cannot prevent local sign-out. Signed-out
                    // credentials cannot use a cached entry; reauthorization invalidates first.
                    try? self.invalidatePlanCatalog(profile.id)
                    var result: [String: Any] = ["type": "result", "account": self.summary(profile)]
                    if let warning { result["warning"] = warning }
                    return result
                })
        case "models":
            let catalog = try await planCatalog(accountID: value["accountId"] as? String ?? "")
            guard catalog.fetchedAt > 0 else {
                throw CredentialStorageError(
                    catalog.error ?? "No models are available for this ChatGPT account.")
            }
            result(["models": catalog.models.map(catalogSummary)])
        case "generate":
            let id = value["accountId"] as? String ?? ""
            let admission = try await planAdmission(
                accountID: id, connectionKey: value["connectionKey"] as? String,
                model: value["model"] as? String ?? "", effort: value["effort"] as? String,
                fast: value["fast"] as? Bool == true)
            var body: [String: Any] = [
                "model": value["model"]!, "instructions": value["systemPrompt"]!,
                "input": [["role": "user", "content": Self.planContent(value)]], "store": false,
                "stream": true,
                "service_tier": admission.tier,
            ]
            if let effort = value["effort"] as? String, !effort.isEmpty {
                body["reasoning"] = ["effort": effort]
            }
            try await streamResponses(body, token: admission.token, accountID: id, native: false)
        case "api-key-status":
            let lease = try await CredentialLease.acquire(in: storage.directory)
            defer { withExtendedLifetime(lease) {} }
            result(["apiConnected": try storage.records.contains(.openAI)])
        case "api-key-save", "api-key-remove":
            let connected = try await withLease {
                let saving = request.action == "api-key-save"
                if saving { try invalidateAPICatalog("openai-api") }
                try storage.saveKey(value["key"] as? String)
                if !saving { try? invalidateAPICatalog("openai-api") }
                return try storage.records.contains(.openAI)
            }
            result(["apiConnected": connected])
        case "api-chat":
            let connection = try await apiConnection(value)
            let body: [String: Any] = [
                "model": value["model"]!,
                "messages": [
                    ["role": "system", "content": value["systemPrompt"]!],
                    [
                        "role": "user",
                        "content": (value["images"] as? [String]).map { images -> Any in
                            [["type": "text", "text": value["userPrompt"]!] as [String: Any]]
                                + images.map {
                                    ["type": "image_url", "image_url": ["url": $0]] as [String: Any]
                                }
                        } ?? value["userPrompt"]!,
                    ],
                ],
                "temperature": value["temperature"] ?? 0.3, "max_tokens": value["maxTokens"] ?? 1024,
                "stream": true,
            ]
            _ = try await streamChat(body, connection: connection) { text, _ in
                self.emit(["type": "delta", "text": text])
            }
            emit(["type": "complete"])
        case "api-realtime":
            let connection = try await apiConnection(value, officialOnly: true)
            let key = connection.key
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
            if plan {
                let effort = (body["reasoning"] as? [String: Any])?["effort"] as? String
                let tier = body["service_tier"] as? String ?? "default"
                let admission = try await planAdmission(
                    accountID: id ?? "", connectionKey: value["connectionKey"] as? String,
                    model: body["model"] as? String ?? "", effort: effort,
                    fast: tier != "default", requestedTier: tier)
                credential = admission.token
            } else {
                let connection = try await apiConnection(value)
                if connection.endpoint != "https://api.openai.com/v1" {
                    try await streamCompatible(body, connection: connection)
                    return
                }
                credential = connection.key
            }
            try await streamResponses(body, token: credential, accountID: plan ? id : nil, native: true)
        case "native-image", "api-image":
            let key = try await apiConnection(value, officialOnly: true).key
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
                    quality: (value["quality"] as? String ?? ""),
                    outputFormat: (value["outputFormat"] as? String ?? "png"), image: image), apiKey: key)
            result(["imageBase64": data.base64EncodedString()])
        default: throw CredentialStorageError("Unsupported Saul operation.")
        }
    }
    private func catalogSummary(_ model: ConnectionModel) -> [String: Any] {
        var value: [String: Any] = [
            "slug": model.id, "display_name": model.name,
            "defaultReasoningEffort": model.defaultEffort, "isDefault": model.isDefault == true,
            "supportedReasoningEfforts": model.efforts.map { ["effort": $0, "description": ""] },
        ]
        if let fast = model.fastTier, ["fast", "priority"].contains(fast) { value["fastTier"] = fast }
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
