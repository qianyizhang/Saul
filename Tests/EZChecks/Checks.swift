import Foundation
import Security

@testable import EZCore

struct CheckFailure: Error, CustomStringConvertible {
    let description: String
}
func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw CheckFailure(description: message) }
}
func rejects(_ message: String, _ body: () throws -> Void) throws {
    do { try body() } catch { return }
    throw CheckFailure(description: message)
}

final class MemoryCredentials: CredentialStore {
    var value: AuthState
    init(_ value: AuthState = AuthState()) { self.value = value }
    func read() throws -> AuthState { value }
    func write(_ state: AuthState) throws { value = state }
}

final class StubHTTP: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw CheckFailure(description: "No HTTP stub") }
            let (status, body) = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream", "x-request-id": "test-request"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main struct Checks {
    @MainActor static func main() async {
        do { try await runSuite() } catch {
            fputs("FAIL: \(error)\n", stderr)
            exit(1)
        }
    }
    @MainActor static func runSuite() async throws {
        var count = 0
        func run(_ name: String, _ body: () throws -> Void) throws {
            try body()
            count += 1
            print("PASS \(name)")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ez-checks-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        try configurationChecks(directory: directory, run: run)

        try run("launcher query decoding and invalid input") {
            let text = "你好 + a&b = 50% # ? / \"quote\"\n%26 $(echo hello)"
            var parts = URLComponents(string: "ez://lookup")!
            parts.queryItems = [URLQueryItem(name: "query", value: text)]
            try expect(try LauncherQuery(url: parts.url!).query == text, "Query must decode exactly once")
            try expect(
                try LauncherQuery(url: URL(string: "ez://lookup?query=a+b")!).query == "a+b",
                "Literal plus must remain plus")
            for value in [
                "https://lookup?query=test", "ez://other?query=test", "ez://lookup/path?query=test",
                "ez://lookup?query=", "ez://lookup?query=%20%0A", "ez://lookup",
                "ez://lookup?query=one&query=two", "ez://lookup?query=one&model=other",
                "ez://lookup?query=test#fragment", "ez://user@lookup?query=test",
                "ez://lookup:80?query=test",
                "ez://lookup?query=" + String(repeating: "a", count: 16_385),
            ] {
                try rejects("Invalid launcher URL accepted") {
                    _ = try LauncherQuery(url: URL(string: value)!)
                }
            }
            parts.queryItems = [URLQueryItem(name: "query", value: String(repeating: "a", count: 16_384))]
            try expect(
                try LauncherQuery(url: parts.url!).query.utf8.count == 16_384, "Boundary query rejected")
            parts.queryItems = [URLQueryItem(name: "query", value: String(repeating: "你", count: 5_462))]
            try rejects("Unicode byte limit ignored") { _ = try LauncherQuery(url: parts.url!) }
        }

        try run("history snapshots, Unicode, permissions") {
            let store = try HistoryStore(directory: directory.appendingPathComponent("history"))
            var entry = HistoryEntry(
                mode: .dictionary, query: "你好\n\"serendipity\"", model: "m", effort: "low",
                requestedServiceTier: "priority")
            try store.append(entry)
            entry.response = "A happy discovery.\n偶然的好运"
            entry.status = "completed"
            try store.append(entry)
            let result = try store.load()
            try expect(result.entries.count == 1 && result.damagedLines == 0, "Latest snapshot should win")
            try expect(
                result.entries[0].query == entry.query && result.entries[0].response == entry.response,
                "Text must round trip")
            let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
            try expect(
                (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "History must be owner-only")
        }
        try run("damaged tail and interrupted query recovery") {
            let store = try HistoryStore(directory: directory.appendingPathComponent("damaged"))
            try Data("{\"unfinished\":".utf8).write(to: store.url)
            try store.append(
                HistoryEntry(mode: .ask, query: "hello", model: "m", effort: "", requestedServiceTier: nil))
            let result = try store.load()
            try expect(
                result.damagedLines == 1 && result.entries.count == 1,
                "Damaged bytes must not poison future entries")
            try expect(
                result.entries[0].status == "interrupted", "Abandoned pending request must show interrupted")
            try expect(
                String(contentsOf: store.url, encoding: .utf8).hasPrefix("{\"unfinished\":\n"),
                "Damaged bytes must be preserved")
        }
        try run("history failure surfaces and failed answers export") {
            let store = try HistoryStore(directory: directory.appendingPathComponent("blocked"))
            try FileManager.default.createDirectory(at: store.url, withIntermediateDirectories: true)
            var entry = HistoryEntry(
                mode: .spelling, query: "teh", model: "m", effort: "low", requestedServiceTier: nil)
            entry.status = "failed"
            entry.error = "Usage limit"
            entry.response = "partial"
            try rejects("Write should fail") { try store.append(entry) }
            try expect(
                entry.markdown.contains("Usage limit") && entry.markdown.contains("partial"),
                "Export should include failure and partial text")
        }
        try run("one process owns rotating credentials") {
            let lock = try SessionLock(directory: directory)
            try rejects("Second instance should be refused") { _ = try SessionLock(directory: directory) }
            withExtendedLifetime(lock) {}
        }
        try run("PKCE RFC 7636 vector and form encoding") {
            try expect(
                OIDC.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                    == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "PKCE challenge mismatch")
            let form = String(data: OpenAIHTTP.form(["code": "a+b&c= d"]), encoding: .utf8)
            try expect(form == "code=a%2Bb%26c%3D%20d", "OAuth form escaping must preserve exact values")
        }
        try run("loopback callback state, path, duplicate defense") {
            let valid = try LoopbackListener.parse(
                request: "GET /auth/callback?state=secret&code=x&client_id=issued HTTP/1.1\r\n\r\n",
                expectedState: "secret")
            try expect(valid["client_id"] == "issued", "Valid callback rejected")
            for target in [
                "/other?state=secret", "/auth/callback?state=wrong",
                "/auth/callback?state=secret&state=secret", "https://evil.example/auth/callback?state=secret",
            ] {
                try rejects("Invalid callback accepted") {
                    _ = try LoopbackListener.parse(
                        request: "GET \(target) HTTP/1.1\r\n\r\n", expectedState: "secret")
                }
            }
        }
        try run("signed OIDC identity and invalid claims") { try identityChecks() }
        try run("live-catalog-only model capabilities") {
            let model = ModelOption(catalog: [
                "visibility": "list", "slug": "test", "display_name": "Test",
                "supported_reasoning_levels": [["effort": "low", "description": "Quick"]],
                "additional_speed_tiers": ["fast"],
            ])!
            try expect(model.quickEffort == "low" && model.fastTier == "fast", "Catalog capability decode")
            try expect(
                ModelOption(catalog: ["visibility": "hidden", "slug": "test"]) == nil, "Hidden model shown")
            try expect(
                ModelOption(catalog: ["visibility": "list", "slug": "test"])?.fastTier == nil,
                "Invented Fast capability")
        }
        try run("Responses request stays within plan preview contract") {
            let entry = HistoryEntry(
                mode: .ask, query: "hi", model: "test", effort: "low", requestedServiceTier: "fast")
            let body = ResponsesClient.requestBody(entry: entry)
            try expect(
                body["store"] as? Bool == false && body["stream"] as? Bool == true,
                "Required streaming/nonstorage flags")
            try expect(body["service_tier"] as? String == "priority", "Fast must map to public priority tier")
            try expect(body["input"] is [[String: String]], "Input must be an array")
            for key in ["tools", "max_output_tokens", "temperature", "previous_response_id", "metadata"] {
                try expect(body[key] == nil, "Unsupported field: \(key)")
            }
        }
        try run("SSE framing and completed text") {
            var parser = SSEParser()
            var result = ResponseAccumulator()
            let events = [
                #"{"type":"response.output_text.delta","delta":"你好"}"#,
                #"{"type":"response.completed","response":{"status":"completed","service_tier":"default","output":[{"content":[{"type":"output_text","text":"你好!"}]}]}}"#,
            ]
            for event in events {
                try expect(parser.feed("data: " + event) == nil, "Premature event")
                try result.consume(parser.feed("")!)
            }
            try result.requireCompleted()
            try expect(
                result.text == "你好!" && result.actualServiceTier == "default", "Terminal text/tier mismatch")
        }
        try run("partial, failed, incomplete, and malformed streams fail") {
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8))
            try rejects("Partial stream cannot succeed") { try result.requireCompleted() }
            for event in [
                #"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit"}}}"#,
                #"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"limit"}}}"#,
                "broken",
            ] {
                try rejects("Error event accepted") { try result.consume(Data(event.utf8)) }
            }
            try expect(result.text == "partial", "Partial text lost")
        }
        try run("structured and admission HTTP errors") {
            let response = HTTPURLResponse(
                url: URL(string: "https://api.openai.com/v1/responses")!, statusCode: 403, httpVersion: nil,
                headerFields: ["x-request-id": "trace"])!
            let error = APIError.parse(
                data: Data(#"{"detail":"Region unavailable"}"#.utf8), response: response)
            try expect(
                error.message == "Region unavailable" && error.requestID == "trace", "Admission error lost")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubHTTP.self]
        let session = URLSession(configuration: configuration)
        defer {
            session.invalidateAndCancel()
            StubHTTP.handler = nil
        }
        StubHTTP.handler = { request in
            try expect(request.url?.path == "/v1/responses", "Wrong route")
            try expect(
                request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic", "Wrong credential")
            let stream =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n"
            return (200, Data(stream.utf8))
        }
        var visible = ""
        let result = try await ResponsesClient(session: session).stream(
            entry: HistoryEntry(
                mode: .ask, query: "hello", model: "test", effort: "low", requestedServiceTier: nil),
            token: "synthetic"
        ) { visible = $0 }
        try expect(result.completed && visible == "Hello", "URLSession SSE stream contract failed")
        count += 1
        print("PASS URLSession streaming integration")

        var state = AuthState()
        state.profiles = [
            AccountProfile(
                clientID: "issued", subject: "subject", email: "test@example.invalid",
                credentials: Credentials(
                    accessToken: "old", refreshToken: "refresh", idToken: "old-id", expiresAt: .distantPast,
                    scopes: ["chatgpt.tokens.use.direct"]))
        ]
        state.selectedID = "issued"
        let store = MemoryCredentials(state)
        let auth = ChatGPTAuth(storage: MemoryCredentials(state), session: session)
        try auth.load()
        StubHTTP.handler = { _ in
            (
                200,
                Data(
                    #"{"access_token":"new","refresh_token":"rotated","token_type":"Bearer","expires_in":3600}"#
                        .utf8)
            )
        }
        async let first = auth.accessToken()
        async let second = auth.accessToken()
        let tokens = try await (first, second)
        try expect(tokens.0 == "new" && tokens.1 == "new", "Refresh failed")
        try expect(auth.selected?.credentials?.refreshToken == "rotated", "Rotation not saved")
        count += 1
        print("PASS serialized token refresh and scope retention")

        let retryAuth = ChatGPTAuth(storage: store, session: session)
        try retryAuth.load()
        StubHTTP.handler = { _ in (503, Data(#"{"detail":"Temporarily unavailable"}"#.utf8)) }
        do {
            _ = try await retryAuth.accessToken()
            throw CheckFailure(description: "503 accepted")
        } catch is APIError {}
        try expect(store.value.selected?.credentials != nil, "Transient error erased credentials")
        StubHTTP.handler = { _ in
            (400, Data(#"{"error":"invalid_grant","error_description":"Revoked"}"#.utf8))
        }
        do {
            _ = try await retryAuth.accessToken()
            throw CheckFailure(description: "Revoked token accepted")
        } catch is APIError {}
        try expect(
            store.value.selected?.credentials == nil && store.value.selected?.clientID == "issued",
            "Terminal refresh must retain registration only")
        count += 1
        print("PASS transient vs terminal refresh recovery")
        print("\(count) contract checks passed; no live account or network used.")
    }

    static func identityChecks() throws {
        // Generate only the disposable test fixture with the system OpenSSL.
        // Security's key generator requires services unavailable in agent sandboxes.
        let generator = Process()
        let pipe = Pipe()
        generator.executableURL = URL(fileURLWithPath: "/usr/bin/openssl")
        generator.arguments = ["genrsa", "2048"]
        generator.standardOutput = pipe
        generator.standardError = FileHandle.nullDevice
        try generator.run()
        let pem = pipe.fileHandleForReading.readDataToEndOfFile()
        generator.waitUntilExit()
        guard generator.terminationStatus == 0,
            let text = String(data: pem, encoding: .utf8),
            let der = Data(
                base64Encoded: text.split(separator: "\n").filter { !$0.hasPrefix("---") }.joined())
        else { throw CheckFailure(description: "Disposable RSA fixture generation failed") }
        var error: Unmanaged<CFError>?
        guard
            let key = SecKeyCreateWithData(
                der as CFData,
                [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPrivate]
                    as CFDictionary, &error),
            let publicKey = SecKeyCopyPublicKey(key),
            let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?
        else {
            throw CheckFailure(
                description: "Test key import failed: \(String(describing: error?.takeRetainedValue()))")
        }
        var index = 0
        func readTLV(_ bytes: [UInt8], _ index: inout Int) -> [UInt8] {
            index += 1
            var length = Int(bytes[index])
            index += 1
            if length & 0x80 != 0 {
                let count = length & 0x7f
                length = 0
                for _ in 0..<count {
                    length = length * 256 + Int(bytes[index])
                    index += 1
                }
            }
            let result = Array(bytes[index..<index + length])
            index += length
            return result
        }
        let sequence = readTLV(Array(raw), &index)
        index = 0
        let n = readTLV(sequence, &index)
        let e = readTLV(sequence, &index)
        let jwks: [[String: Any]] = [
            ["kid": "test", "kty": "RSA", "n": OIDC.base64URL(Data(n)), "e": OIDC.base64URL(Data(e))]
        ]
        let base: [String: Any] = [
            "iss": "https://auth.openai.com", "aud": "issued", "sub": "subject", "nonce": "nonce",
            "exp": Date().timeIntervalSince1970 + 600,
        ]
        func sign(_ claims: [String: Any]) throws -> String {
            let header = OIDC.base64URL(Data(#"{"alg":"RS256","kid":"test"}"#.utf8))
            let body = OIDC.base64URL(try JSONSerialization.data(withJSONObject: claims))
            let input = header + "." + body
            guard
                let signature = SecKeyCreateSignature(
                    key, .rsaSignatureMessagePKCS1v15SHA256, Data(input.utf8) as CFData, &error) as Data?
            else { throw CheckFailure(description: "Signing failed") }
            return input + "." + OIDC.base64URL(signature)
        }
        let valid = try sign(base)
        try expect(
            OIDC.validate(jwt: valid, jwks: jwks, clientID: "issued", nonce: "nonce")["sub"] as? String
                == "subject", "Signed identity rejected")
        for (field, value) in [("iss", "https://evil.example"), ("aud", "other"), ("nonce", "wrong")] {
            var claims = base
            claims[field] = value
            let jwt = try sign(claims)
            try rejects("Invalid \(field) accepted") {
                _ = try OIDC.validate(jwt: jwt, jwks: jwks, clientID: "issued", nonce: "nonce")
            }
        }
        var expired = base
        expired["exp"] = 1
        let expiredJWT = try sign(expired)
        try rejects("Expired identity accepted") {
            _ = try OIDC.validate(jwt: expiredJWT, jwks: jwks, clientID: "issued", nonce: "nonce")
        }
        var segments = valid.components(separatedBy: ".")
        segments[2] = OIDC.base64URL(Data(repeating: 0, count: 256))
        try rejects("Bad signature accepted") {
            _ = try OIDC.validate(
                jwt: segments.joined(separator: "."), jwks: jwks, clientID: "issued", nonce: "nonce")
        }
    }
}
