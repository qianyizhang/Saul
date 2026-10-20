import EZCheckSupport
import Foundation
import Security

@testable import EZCore

@MainActor func identityChecks() -> [CheckCase] {
    [
        CheckCase("identity: PKCE RFC 7636 vector and form encoding") { _ in
            try expect(
                OIDC.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                    == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "PKCE challenge mismatch")
            let form = String(data: OpenAIHTTP.form(["code": "a+b&c= d"]), encoding: .utf8)
            try expect(form == "code=a%2Bb%26c%3D%20d", "OAuth form escaping must preserve exact values")
        },
        CheckCase("identity: loopback callback state, path, duplicate defense") { _ in
            let valid = try LoopbackListener.parse(
                request: "GET /auth/callback?state=secret&code=x&client_id=issued HTTP/1.1\r\n\r\n",
                expectedState: "secret")
            try expect(valid["client_id"] == "issued", "Valid callback rejected")
            for target in [
                "/other?state=secret", "/auth/callback?state=wrong",
                "/auth/callback?state=secret&state=secret", "https://evil.example/auth/callback?state=secret",
            ] {
                try expectThrows(EZError.self) {
                    _ = try LoopbackListener.parse(
                        request: "GET \(target) HTTP/1.1\r\n\r\n", expectedState: "secret")
                }
            }
        },
        CheckCase("identity: signed OIDC identity and invalid claims") { _ in
            try checkSignedIdentity()
        },
    ]
}

private func checkSignedIdentity() throws {
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
    else { throw CheckFailure("Disposable RSA fixture generation failed") }
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
            "Test key import failed: \(String(describing: error?.takeRetainedValue()))")
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
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let base: [String: Any] = [
        "iss": "https://auth.openai.com", "aud": "issued", "sub": "subject", "nonce": "nonce",
        "exp": now.timeIntervalSince1970 + 600,
    ]
    func sign(_ claims: [String: Any]) throws -> String {
        let header = OIDC.base64URL(Data(#"{"alg":"RS256","kid":"test"}"#.utf8))
        let body = OIDC.base64URL(try JSONSerialization.data(withJSONObject: claims))
        let input = header + "." + body
        guard
            let signature = SecKeyCreateSignature(
                key, .rsaSignatureMessagePKCS1v15SHA256, Data(input.utf8) as CFData, &error) as Data?
        else { throw CheckFailure("Signing failed") }
        return input + "." + OIDC.base64URL(signature)
    }
    let valid = try sign(base)
    try expect(
        OIDC.validate(jwt: valid, jwks: jwks, clientID: "issued", nonce: "nonce", now: now)["sub"] as? String
            == "subject", "Signed identity rejected")
    for (field, value) in [("iss", "https://evil.example"), ("aud", "other"), ("nonce", "wrong")] {
        var claims = base
        claims[field] = value
        let jwt = try sign(claims)
        try expectThrows(EZError.self) {
            _ = try OIDC.validate(jwt: jwt, jwks: jwks, clientID: "issued", nonce: "nonce", now: now)
        }
    }
    var expired = base
    expired["exp"] = 1
    let expiredJWT = try sign(expired)
    try expectThrows(EZError.self) {
        _ = try OIDC.validate(jwt: expiredJWT, jwks: jwks, clientID: "issued", nonce: "nonce", now: now)
    }
    var segments = valid.components(separatedBy: ".")
    segments[2] = OIDC.base64URL(Data(repeating: 0, count: 256))
    try expectThrows(EZError.self) {
        _ = try OIDC.validate(
            jwt: segments.joined(separator: "."), jwks: jwks, clientID: "issued", nonce: "nonce", now: now)
    }
}
