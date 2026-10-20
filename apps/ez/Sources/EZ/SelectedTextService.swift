import AppKit
import EZCore

/// Services supplies its own pasteboard; never read or write the general clipboard.
@MainActor final class SelectedTextService: NSObject {
    private let receive: (String) throws -> Void

    init(receive: @escaping (String) throws -> Void) {
        self.receive = receive
    }

    @objc func lookupSelectedText(
        _ pasteboard: NSPasteboard, userData: String?,
        error errorPointer: AutoreleasingUnsafeMutablePointer<NSString?>
    ) {
        do {
            guard let text = pasteboard.string(forType: .string) else {
                throw EZError("Select plain text in the source app before choosing Look Up in EZ.")
            }
            try receive(text)
        } catch {
            errorPointer.pointee = error.localizedDescription as NSString
        }
    }
}
