import AppKit
import EZCheckSupport
import EZCore

/// A host-native check: uses private pasteboards and never modifies the clipboard.
@main struct ServicesCheck {
    @MainActor static func main() async {
        exit(
            await CheckRunner.run([
                CheckCase("services: bundle declaration matches the Objective-C callback") { _ in
                    let data = try Data(contentsOf: URL(fileURLWithPath: "Resources/Info.plist"))
                    guard
                        let plist = try PropertyListSerialization.propertyList(from: data, format: nil)
                            as? [String: Any],
                        let services = plist["NSServices"] as? [[String: Any]],
                        let spec = services.first, let message = spec["NSMessage"] as? String
                    else { throw CheckFailure("Missing Services declaration") }
                    try expect(services.count == 1, "Expected one selected-text service")
                    let provider = SelectedTextService { _ in }
                    try expect(
                        provider.responds(to: NSSelectorFromString(message + ":userData:error:")),
                        "Service selector is missing")
                    try expect(
                        spec["NSSendTypes"] as? [String] == [NSPasteboard.PasteboardType.string.rawValue],
                        "Service does not advertise plain text")
                    try expect(spec["NSReturnTypes"] == nil, "Service would replace the source selection")
                },
                CheckCase("services: private pasteboard reaches a draft without modifying either pasteboard")
                { directory in
                    let f = try StateFixture(directory: directory)
                    defer { f.model.shutdown() }
                    f.model.chooseRecipe(f.single.id)
                    let pasteboard = NSPasteboard.withUniqueName()
                    defer { pasteboard.releaseGlobally() }
                    let text = "café 中文 🧪\n+ & %"
                    try expect(
                        pasteboard.setString(text, forType: .string),
                        "Cannot write the private test pasteboard")
                    let originalChanges = pasteboard.changeCount
                    let clipboardChanges = NSPasteboard.general.changeCount
                    var presentations = 0
                    let provider = SelectedTextService { text in
                        try f.model.prepareSelectedText(text)
                        presentations += 1
                    }
                    var error: NSString?
                    provider.lookupSelectedText(pasteboard, userData: nil, error: &error)
                    try expect(
                        error == nil && f.model.query == text && presentations == 1,
                        "Selection did not reach the draft")
                    try expect(!f.model.busy && f.model.entries.isEmpty, "Service submitted a request")
                    try expect(
                        pasteboard.changeCount == originalChanges
                            && pasteboard.string(forType: .string) == text,
                        "Service changed the source pasteboard")
                    try expect(
                        NSPasteboard.general.changeCount == clipboardChanges,
                        "Clipboard changed during the callback")
                    provider.lookupSelectedText(pasteboard, userData: nil, error: &error)
                    try expect(
                        error != nil && presentations == 1 && f.model.query == text,
                        "Repeated service invocation replaced an existing draft")
                },
                CheckCase("services: missing text reports a Services error without presenting") { _ in
                    let pasteboard = NSPasteboard.withUniqueName()
                    defer { pasteboard.releaseGlobally() }
                    let provider = SelectedTextService { _ in throw CheckFailure("Unexpected delivery") }
                    var error: NSString?
                    provider.lookupSelectedText(pasteboard, userData: nil, error: &error)
                    try expect(error?.contains("Select plain text") == true, "Missing text was not reported")
                },
            ]))
    }
}
