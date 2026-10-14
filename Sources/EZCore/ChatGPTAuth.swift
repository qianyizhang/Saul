import Foundation

@MainActor public final class ChatGPTAuth {
    public private(set) var state = AuthState()
    public var selected: AccountProfile? { state.selected }
    private let storage: CredentialStore
    private let session: URLSession
    private var listener: LoopbackListener?
    private var refreshTask: Task<String, Error>?
    private var refreshingID: String?
    public init(storage: CredentialStore = KeychainStore(), session: URLSession? = nil) {
        self.storage = storage
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = session ?? URLSession(configuration: configuration)
    }
    public func load() async throws {
        let restored = try await storage.read()
        try Task.checkCancellation()
        state = restored
    }
    public func select(_ id: String) throws {
        guard state.profiles.contains(where: { $0.id == id }) else { throw EZError("Unknown account.") }
        var next = state
        next.selectedID = id
        try save(next)
    }
    private func save(_ next: AuthState) throws {
        try storage.write(next)
        state = next
    }
    private func upsert(_ profile: AccountProfile, select: Bool = false) throws {
        var next = state
        if let index = next.profiles.firstIndex(where: { $0.id == profile.id }) {
            next.profiles[index] = profile
        } else {
            next.profiles.append(profile)
        }
        if select { next.selectedID = profile.id }
        try save(next)
    }
    public func signIn(newAccount: Bool = false, enablePlan: Bool = false, openBrowser: (URL) -> Bool)
        async throws
    {
        guard listener == nil else { throw EZError("A sign-in is already in progress.") }
        try save(state)  // Persist the installation identity before leaving for the browser.
        let previous = newAccount ? nil : selected
        let initialID = previous?.clientID ?? "dynamic_agent_client"
        let stateToken = try OIDC.random()
        let nonce = try OIDC.random()
        let verifier = try OIDC.random()
        let listener = LoopbackListener()
        self.listener = listener
        defer {
            listener.cancel()
            self.listener = nil
        }
        let redirect = try await listener.start(state: stateToken)
        var url = URLComponents(string: "https://auth.openai.com/api/accounts/authorize")!
        var params = [
            "client_id": initialID, "ext_agent_host_id": state.hostID, "response_type": "code",
            "redirect_uri": redirect.absoluteString,
            "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            "resource": "https://api.openai.com/v1", "state": stateToken, "nonce": nonce,
            "code_challenge_method": "S256", "code_challenge": OIDC.challenge(verifier),
        ]
        if previous == nil { params["agent_name_hint"] = "EZ" }
        if let hint = previous?.credentials?.idToken { params["id_token_hint"] = hint }
        if let email = previous?.email { params["login_hint"] = email }
        if enablePlan { params["prompt"] = "consent" }
        url.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let authorizationURL = url.url, openBrowser(authorizationURL) else {
            throw EZError("Could not open the sign-in browser.")
        }
        let callback = try await listener.callback()
        if let error = callback["error"] {
            throw EZError(
                error == "access_denied" ? "Sign-in permission was declined." : "Sign-in failed: \(error)")
        }
        guard let code = callback["code"], !code.isEmpty else {
            throw EZError("Sign-in did not return an authorization code.")
        }
        let issuedID = callback["client_id"] ?? previous?.clientID
        guard let issuedID, !issuedID.isEmpty, issuedID != "dynamic_agent_client" else {
            throw EZError("Registration did not return an issued client ID.")
        }
        if let previous, issuedID != previous.clientID {
            throw EZError("Sign-in returned a different client registration.")
        }
        var profile =
            previous ?? AccountProfile(clientID: issuedID, subject: nil, email: nil, credentials: nil)
        // Preserve registration before the first exchange, including invalid_grant recovery.
        try upsert(profile, select: state.selectedID == nil)
        let token = try await tokenRequest([
            "grant_type": "authorization_code", "client_id": issuedID, "code": code,
            "code_verifier": verifier, "redirect_uri": redirect.absoluteString,
            "resource": "https://api.openai.com/v1",
        ])
        guard let idToken = token["id_token"] as? String else {
            throw EZError("Sign-in did not return an ID token.")
        }
        let identity = try await verify(idToken, clientID: issuedID, nonce: nonce)
        if let subject = previous?.subject, subject != identity["sub"] as? String {
            throw EZError("Signed-in identity does not match this saved account.")
        }
        profile.subject = identity["sub"] as? String
        profile.email = identity["email"] as? String
        profile.credentials = try credentials(token, previous: nil, idToken: idToken)
        try Task.checkCancellation()
        try upsert(profile, select: true)
    }
    public func cancelSignIn() { listener?.cancel() }
    public func accessToken() async throws -> String {
        guard let profile = selected, let credentials = profile.credentials else {
            throw EZError("Continue with ChatGPT to sign in.")
        }
        guard credentials.canUsePlan else {
            throw EZError("Enable ChatGPT plan usage in account settings first.")
        }
        if credentials.expiresAt.timeIntervalSinceNow > 60 { return credentials.accessToken }
        if let refreshTask {
            guard refreshingID == profile.id else {
                throw EZError("Another account is refreshing. Please try again.")
            }
            return try await refreshTask.value
        }
        refreshingID = profile.id
        let task = Task { try await self.refresh(profile) }
        refreshTask = task
        defer {
            refreshTask = nil
            refreshingID = nil
        }
        return try await task.value
    }
    private func refresh(_ profile: AccountProfile) async throws -> String {
        guard let old = profile.credentials, let refresh = old.refreshToken else {
            throw EZError("Sign in again to renew your ChatGPT session.")
        }
        do {
            let token = try await tokenRequest([
                "grant_type": "refresh_token", "client_id": profile.clientID, "refresh_token": refresh,
                "resource": "https://api.openai.com/v1",
            ])
            let idToken = token["id_token"] as? String ?? old.idToken
            if token["id_token"] != nil {
                let identity = try await verify(idToken, clientID: profile.clientID, nonce: nil)
                guard identity["sub"] as? String == profile.subject else {
                    throw EZError("Refreshed identity does not match the saved account.")
                }
            }
            var updated = profile
            updated.credentials = try credentials(token, previous: old, idToken: idToken)
            try upsert(updated)
            guard updated.credentials!.canUsePlan else {
                throw EZError("ChatGPT plan usage permission is no longer enabled.")
            }
            return updated.credentials!.accessToken
        } catch let error as APIError {
            let terminal = [
                "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
                "refresh_token_invalidated", "refresh_token_reused",
            ]
            if terminal.contains(error.code ?? "") {
                var cleared = profile
                cleared.credentials = nil
                try upsert(cleared)
            }
            throw error
        }
    }
    public func signOut() async throws -> String? {
        guard var profile = selected else { return nil }
        var warning: String?
        if let refresh = profile.credentials?.refreshToken {
            do {
                let config = try await discovery()
                let endpoint = try trustedURL(config["revocation_endpoint"] as? String)
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                request.httpBody = OpenAIHTTP.form([
                    "token": refresh, "token_type_hint": "refresh_token", "client_id": profile.clientID,
                ])
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse else {
                    throw EZError("Invalid revocation response.")
                }
                guard response.statusCode == 200 else { throw APIError.parse(data: data, response: response) }
            } catch {
                warning =
                    "Signed out locally. Remote revocation was not confirmed; disconnect EZ in ChatGPT Settings → Usage."
            }
        }
        profile.credentials = nil
        try upsert(profile)
        return warning
    }
    private func tokenRequest(_ fields: [String: String]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = OpenAIHTTP.form(fields)
        return try await OpenAIHTTP.json(request, session: session)
    }
    private func credentials(_ token: [String: Any], previous: Credentials?, idToken: String) throws
        -> Credentials
    {
        guard let access = token["access_token"] as? String, !access.isEmpty,
            let expires = token["expires_in"] as? Double, expires > 0,
            (token["token_type"] as? String)?.lowercased() == "bearer"
        else { throw EZError("OpenAI returned an incomplete token response.") }
        let scopes =
            (token["scope"] as? String)?.split(separator: " ").map(String.init) ?? previous?.scopes ?? []
        return Credentials(
            accessToken: access, refreshToken: token["refresh_token"] as? String ?? previous?.refreshToken,
            idToken: idToken, expiresAt: Date().addingTimeInterval(expires), scopes: scopes)
    }
    private func discovery() async throws -> [String: Any] {
        let config = try await OpenAIHTTP.json(
            URLRequest(url: URL(string: "https://auth.openai.com/.well-known/openid-configuration")!),
            session: session)
        guard config["issuer"] as? String == "https://auth.openai.com" else {
            throw EZError("Unexpected OpenAI identity issuer.")
        }
        return config
    }
    private func trustedURL(_ string: String?) throws -> URL {
        guard let string, let url = URL(string: string), url.scheme == "https", url.host == "auth.openai.com",
            url.user == nil, url.password == nil
        else { throw EZError("Unexpected OpenAI identity endpoint.") }
        return url
    }
    private func verify(_ jwt: String, clientID: String, nonce: String?) async throws -> [String: Any] {
        let config = try await discovery()
        let url = try trustedURL(config["jwks_uri"] as? String)
        let jwks = try await OpenAIHTTP.json(URLRequest(url: url), session: session)
        return try OIDC.validate(
            jwt: jwt, jwks: jwks["keys"] as? [[String: Any]] ?? [], clientID: clientID, nonce: nonce)
    }
}
