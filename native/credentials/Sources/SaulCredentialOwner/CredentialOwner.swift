import Foundation
import SaulCredentialClient
import SaulNativeValues

@MainActor package final class CredentialOwner {
  let storage: SharedAuthStorage
  let http: ConnectionHTTP
  let emit: ([String: Any]) -> Void
  let connectionDefinitions: () throws -> [ConnectionDefinition]
  package init(
    storage: SharedAuthStorage, http: ConnectionHTTP = ConnectionHTTP(),
    connectionDefinitions: @escaping () throws -> [ConnectionDefinition] = {
      try SharedSettingsDocument.readLibrary().connections
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
  package func run(_ request: CredentialRequest) async throws {
    do { try await execute(request.operation) } catch {
      guard let failure = error as? CredentialHTTPError, failure.code == "model_not_found" else {
        throw error
      }
      try Task.checkCancellation()
      await refreshUnavailableModel(request.operation)
      try Task.checkCancellation()
      throw CredentialStorageError(
        "The selected model is unavailable. Update its preset in Settings.")
    }
  }

  private func refreshUnavailableModel(_ operation: CredentialOperation) async {
    let key: String?
    switch operation {
    case .generate(let text):
      _ = try? await planCatalog(
        accountID: text.accountID, connectionKey: text.connectionKey, intent: .refresh)
      return
    case .nativeResponses(let request):
      if case .plan(let accountID) = request.route {
        _ = try? await planCatalog(
          accountID: accountID, connectionKey: request.connectionKey, intent: .refresh)
        return
      }
      key = request.connectionKey
    case .apiChat(let chat): key = chat.connectionKey
    case .apiRealtime(_, _, let connectionKey): key = connectionKey
    case .image(let image): key = image.connectionKey
    default: return
    }
    if let key { _ = try? await connectionCatalog(key, intent: .refresh) }
  }

  package static func planContent(_ input: CredentialOperation.PlanText) -> Any {
    guard !input.pdfURLs.isEmpty || !input.images.isEmpty else { return input.userPrompt }
    return [["type": "input_text", "text": input.userPrompt]]
      + input.images.map { ["type": "input_image", "image_url": $0, "detail": "auto"] }
      + input.pdfURLs.map { ["type": "input_file", "file_url": $0] }
  }

  private func execute(_ operation: CredentialOperation) async throws {
    func result(_ value: [String: Any] = [:]) {
      emit(value.merging(["type": "result"]) { _, new in new })
    }
    switch operation {
    case .connectionStatus(let key):
      let status: [String: Any] = try await withLease {
        let definition = try connectionDefinition(key)
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
    case .connectionCatalog(let key, let intent, let includeDefault):
      var catalog = try await connectionCatalog(key, intent: intent)
      if !includeDefault {
        for index in catalog.models.indices { catalog.models[index].isDefault = nil }
      }
      result(["catalog": try JSONSerialization.jsonObject(with: JSONEncoder().encode(catalog))])
    case .connectionKey(let id, let endpoint, let key):
      let status = try await withLease {
        if key != nil { try invalidateAPICatalog(id) }
        try storage.saveConnectionKey(id, endpoint: endpoint, key: key)
        if key == nil { try? invalidateAPICatalog(id) }
        return try storage.connectionStatus(id)
      }
      result(["connection": status])
    case .status, .accounts:
      emit(try await locked { try self.status($0) })
    case .select(let id):
      emit(
        try await locked { auth in
          try auth.select(id)
          return try self.status(auth)
        })
    case .login(let id, let consent):
      emit(
        try await locked { auth in
          if let id {
            try self.invalidatePlanCatalog(id)
            try auth.select(id)
          }
          try await auth.signIn(
            newAccount: id == nil, enablePlan: consent
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
    case .logout(let id):
      emit(
        try await locked { auth in
          try auth.select(id)
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
    case .models(let id):
      let catalog = try await planCatalog(accountID: id)
      guard catalog.fetchedAt > 0 else {
        throw CredentialStorageError(
          catalog.error ?? "No models are available for this ChatGPT account.")
      }
      result(["models": catalog.models.map(catalogSummary)])
    case .generate(let text):
      let admission = try await planAdmission(
        accountID: text.accountID, connectionKey: text.connectionKey,
        model: text.model, effort: text.effort, fast: text.fast)
      var body: [String: Any] = [
        "model": text.model, "instructions": text.systemPrompt,
        "input": [["role": "user", "content": Self.planContent(text)]], "store": false,
        "stream": true, "service_tier": admission.tier,
      ]
      if let effort = text.effort, !effort.isEmpty { body["reasoning"] = ["effort": effort] }
      try await streamResponses(
        JSONSerialization.data(withJSONObject: body), token: admission.token,
        accountID: text.accountID, native: false)
    case .apiKeyStatus:
      let connected = try await withLease { try storage.records.contains(.openAI) }
      result(["apiConnected": connected])
    case .apiKey(let key):
      let connected = try await withLease {
        if key != nil { try invalidateAPICatalog("openai-api") }
        try storage.saveKey(key)
        if key == nil { try? invalidateAPICatalog("openai-api") }
        return try storage.records.contains(.openAI)
      }
      result(["apiConnected": connected])
    case .apiChat(let chat):
      let connection = try await apiAdmission(
        connectionKey: chat.connectionKey, model: chat.model, capability: .write)
      let content: Any
      if let images = chat.images {
        content =
          [["type": "text", "text": chat.userPrompt] as [String: Any]]
          + images.map { ["type": "image_url", "image_url": ["url": $0]] }
      } else {
        content = chat.userPrompt
      }
      let body: [String: Any] = [
        "model": chat.model,
        "messages": [
          ["role": "system", "content": chat.systemPrompt], ["role": "user", "content": content],
        ],
        "temperature": chat.temperature, "max_tokens": chat.maxTokens, "stream": true,
      ]
      _ = try await streamChat(body, connection: connection) { text, _ in
        self.emit(["type": "delta", "text": text])
      }
      emit(["type": "complete"])
    case .apiRealtime(let model, let voice, let key):
      let connection = try await apiAdmission(connectionKey: key, model: model, capability: .speak)
      let body: [String: Any] = [
        "session": [
          "type": "realtime", "model": model, "output_modalities": ["audio"],
          "audio": [
            "input": ["turn_detection": NSNull()],
            "output": [
              "voice": voice, "format": ["type": "audio/pcm", "rate": 24000],
            ],
          ],
          "tools": [], "max_output_tokens": 2048,
        ]
      ]
      let secret = try await http.json(
        route: .realtime, body: JSONSerialization.data(withJSONObject: body),
        credential: connection.key)
      guard let secret = secret["value"] as? String,
        secret.range(of: "^[A-Za-z0-9_-]{1,4096}$", options: .regularExpression) != nil
      else {
        throw CredentialStorageError("OpenAI returned an invalid Realtime client secret.")
      }
      result(["clientSecret": secret])
    case .nativeResponses(let request):
      switch request.route {
      case .plan(let accountID):
        let tier = request.tier ?? "default"
        let admission = try await planAdmission(
          accountID: accountID, connectionKey: request.connectionKey,
          model: request.model, effort: request.effort, fast: tier != "default", requestedTier: tier
        )
        try await streamResponses(
          request.providerBody, token: admission.token, accountID: accountID, native: true)
      case .api:
        let connection = try await apiAdmission(
          connectionKey: request.connectionKey, model: request.model, capability: .write)
        if connection.endpoint != "https://api.openai.com/v1" {
          try await streamCompatible(request, connection: connection)
        } else {
          try await streamResponses(
            request.providerBody, token: connection.key, accountID: nil, native: true)
        }
      }
    case .image(let request):
      let connection = try await apiAdmission(
        connectionKey: request.connectionKey, model: request.model, capability: .draw)
      var image: ImageAttachment?
      if let encoded = request.imageBase64 {
        guard let data = Data(base64Encoded: encoded) else {
          throw CredentialStorageError("The image attachment is invalid.")
        }
        image = try ImageAttachment(data: data, name: request.imageName ?? "input")
      }
      let data = try await ImagesClient().generate(
        ImageGenerationRequest(
          prompt: request.prompt, model: request.model, size: request.size,
          quality: request.quality,
          outputFormat: request.outputFormat, image: image), apiKey: connection.key)
      result(["imageBase64": data.base64EncodedString()])
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
  private func streamResponses(_ body: Data, token: String, accountID: String?, native: Bool)
    async throws
  {
    var complete = false
    try await http.stream(
      route: .responses, body: body, credential: token
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
      throw CredentialStorageError(
        "OpenAI disconnected before response.completed. Retry explicitly.")
    }
    emit(["type": "complete"])
  }
}
