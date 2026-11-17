import AppKit
import SwiftUI

extension View {
    /// Keep Return in the draft when SwiftUI's vertical TextField would select it instead.
    func multilineDraftReturn() -> some View {
        modifier(MultilineDraftReturn())
    }
}

private struct MultilineDraftReturn: ViewModifier {
    @State private var anchor = NSView()

    func body(content: Content) -> some View {
        content
            .background(WindowAnchor(view: anchor).allowsHitTesting(false))
            .onKeyPress(keys: [.return, KeyEquivalent("\u{3}")], phases: [.down, .repeat]) { press in
                guard press.modifiers.isSubset(of: [.shift, .capsLock, .numericPad]),
                    let editor = anchor.window?.firstResponder as? NSTextView,
                    editor.isEditable, !editor.hasMarkedText()
                else { return .ignored }
                editor.insertText("\n", replacementRange: editor.selectedRange())
                return .handled
            }
    }

    // Resolve the editor in this field's own window, including the nonactivating Quick Lookup panel.
    private struct WindowAnchor: NSViewRepresentable {
        let view: NSView

        func makeNSView(context: Context) -> NSView { view }
        func updateNSView(_ view: NSView, context: Context) {}
    }
}
