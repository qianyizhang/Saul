import AppKit

@MainActor enum TextClipboard {
    static let failure = "Could not copy. Select the text and copy it manually."

    static func write(_ text: String) -> Bool {
        let clipboard = NSPasteboard.general
        clipboard.clearContents()
        return clipboard.setString(text, forType: .string)
    }
}
