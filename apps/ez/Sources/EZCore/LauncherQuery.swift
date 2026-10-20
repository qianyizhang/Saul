import Foundation

/// A single explicit launcher submission. URL text is decoded exactly once.
public struct LauncherQuery {
    public let query: String

    public init(url: URL) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
            parts.scheme == "ez", parts.host == "lookup", parts.path.isEmpty,
            parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
            let items = parts.queryItems, items.count == 1, items[0].name == "query",
            let query = items[0].value,
            !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            query.utf8.count <= 16_384
        else {
            throw EZError("Invalid EZ launcher query. Enter 1–16,384 UTF-8 bytes of text in Raycast.")
        }
        self.query = query
    }
}
