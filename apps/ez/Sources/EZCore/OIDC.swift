import CryptoKit
import Foundation
import Security

public enum OIDC {
    public static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
            of: "/", with: "_"
        ).replacingOccurrences(of: "=", with: "")
    }
    public static func decode(_ text: String) -> Data? {
        let raw = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: raw + String(repeating: "=", count: (4 - raw.count % 4) % 4))
    }
    public static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw EZError("Could not generate secure sign-in randomness.")
        }
        return base64URL(Data(bytes))
    }
    public static func challenge(_ verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }
    public static func validate(
        jwt: String, jwks: [[String: Any]], clientID: String, nonce: String?, now: Date = Date()
    ) throws -> [String: Any] {
        let pieces = jwt.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard pieces.count == 3,
            let headerData = decode(pieces[0]), let claimsData = decode(pieces[1]),
            let signature = decode(pieces[2]),
            let header = try JSONSerialization.jsonObject(with: headerData) as? [String: Any],
            let claims = try JSONSerialization.jsonObject(with: claimsData) as? [String: Any],
            header["alg"] as? String == "RS256", let kid = header["kid"] as? String,
            let jwk = jwks.first(where: { $0["kid"] as? String == kid && $0["kty"] as? String == "RSA" }),
            let n = jwk["n"] as? String, let e = jwk["e"] as? String,
            let modulus = decode(n), let exponent = decode(e)
        else { throw EZError("Invalid or unsupported sign-in identity signature.") }
        if let use = jwk["use"] as? String, use != "sig" {
            throw EZError("Identity key cannot verify signatures.")
        }
        if let alg = jwk["alg"] as? String, alg != "RS256" {
            throw EZError("Identity key algorithm mismatch.")
        }
        let keyData = der(0x30, integer(modulus) + integer(exponent))
        var keyError: Unmanaged<CFError>?
        guard
            let key = SecKeyCreateWithData(
                keyData as CFData,
                [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic]
                    as CFDictionary, &keyError),
            SecKeyVerifySignature(
                key, .rsaSignatureMessagePKCS1v15SHA256, Data((pieces[0] + "." + pieces[1]).utf8) as CFData,
                signature as CFData, &keyError)
        else {
            throw EZError("Sign-in identity signature verification failed.")
        }
        let audiences = claims["aud"] as? [String] ?? (claims["aud"] as? String).map { [$0] } ?? []
        guard claims["iss"] as? String == "https://auth.openai.com", audiences.contains(clientID),
            let exp = claims["exp"] as? Double, exp > now.timeIntervalSince1970,
            let subject = claims["sub"] as? String, !subject.isEmpty
        else { throw EZError("Sign-in identity issuer, audience, subject, or expiry is invalid.") }
        if audiences.count > 1 || claims["azp"] != nil {
            guard claims["azp"] as? String == clientID else {
                throw EZError("Sign-in identity authorized party mismatch.")
            }
        }
        if let nbf = claims["nbf"] as? Double, nbf > now.timeIntervalSince1970 + 30 {
            throw EZError("Sign-in identity is not yet valid.")
        }
        if let nonce, claims["nonce"] as? String != nonce {
            throw EZError("Sign-in identity nonce mismatch.")
        }
        return claims
    }
    private static func integer(_ data: Data) -> Data {
        var bytes = Data(data.drop(while: { $0 == 0 }))
        if bytes.isEmpty { bytes = Data([0]) }
        if bytes[bytes.startIndex] & 0x80 != 0 { bytes.insert(0, at: bytes.startIndex) }
        return der(0x02, bytes)
    }
    private static func der(_ tag: UInt8, _ data: Data) -> Data {
        var length = data.count
        var prefix = Data([tag])
        if length < 128 {
            prefix.append(UInt8(length))
        } else {
            var bytes: [UInt8] = []
            while length > 0 {
                bytes.insert(UInt8(length & 255), at: 0)
                length >>= 8
            }
            prefix.append(0x80 | UInt8(bytes.count))
            prefix.append(contentsOf: bytes)
        }
        return prefix + data
    }
}
