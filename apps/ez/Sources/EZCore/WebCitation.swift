import Foundation

public struct WebCitation: Codable, Equatable, Sendable {
    public var start: Int
    public var end: Int
    public var title: String
    public var url: String

    public init?(annotation: [String: Any], offset: Int = 0) {
        guard annotation["type"] as? String == "url_citation",
            let start = annotation["start_index"] as? Int,
            let end = annotation["end_index"] as? Int, start >= 0, end >= start,
            let raw = annotation["url"] as? String, raw.count <= 8192,
            let link = URL(string: raw), ["https", "http"].contains(link.scheme?.lowercased() ?? ""),
            link.host != nil, link.user == nil, link.password == nil,
            raw.unicodeScalars.allSatisfy({ $0.value > 32 }), offset >= 0,
            start <= Int.max - offset, end <= Int.max - offset
        else { return nil }
        self.start = start + offset
        self.end = end + offset
        self.title = String((annotation["title"] as? String ?? link.host ?? "Source").prefix(300))
        self.url = link.absoluteString
    }

    /// API indices count Unicode characters; walk scalars so emoji don't shift links.
    public static func markdown(_ text: String, citations: [Self]) -> String {
        var result = text
        var nextStart = text.unicodeScalars.count
        var overflow: [Self] = []
        for citation in citations.sorted(by: { $0.start > $1.start }) {
            guard
                let safe = Self(annotation: [
                    "type": "url_citation", "start_index": citation.start,
                    "end_index": citation.end, "title": citation.title, "url": citation.url,
                ])
            else { continue }
            guard safe.start <= safe.end, safe.end <= nextStart else {
                overflow.append(safe)
                continue
            }
            let scalars = result.unicodeScalars
            let start = scalars.index(scalars.startIndex, offsetBy: safe.start)
            let end = scalars.index(scalars.startIndex, offsetBy: safe.end)
            let original = String(result[start..<end])
            let label = original.isEmpty || original.contains("\u{E200}") ? safe.title : original
            let escaped = label.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]")
                .replacingOccurrences(of: "\n", with: " ")
            let url = safe.url.replacingOccurrences(of: "(", with: "%28")
                .replacingOccurrences(of: ")", with: "%29").replacingOccurrences(of: " ", with: "%20")
            result.replaceSubrange(start..<end, with: "[\(escaped)](\(url))")
            nextStart = safe.start
        }
        for citation in overflow.reversed() {
            let label = citation.title.replacingOccurrences(of: "[", with: "").replacingOccurrences(
                of: "]", with: "")
            let url = citation.url.replacingOccurrences(of: "(", with: "%28").replacingOccurrences(
                of: ")", with: "%29")
            result += "\n\n[\(label)](\(url))"
        }
        return result
    }
}
