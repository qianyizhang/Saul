import AppKit
@preconcurrency import ApplicationServices

/// One bounded read per invocation. Never copies, polls, or reads the whole document.
enum SelectedTextCapture {
    static var isAllowed: Bool { AXIsProcessTrusted() }

    @MainActor static func openPermissionSettings() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
        if let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        {
            NSWorkspace.shared.open(url)
        }
    }

    static func read(from processID: pid_t) async -> String? {
        await Task.detached(priority: .userInitiated) {
            guard isAllowed else { return nil }
            let application = AXUIElementCreateApplication(processID)
            AXUIElementSetMessagingTimeout(application, 0.15)
            var value: CFTypeRef?
            guard
                AXUIElementCopyAttributeValue(
                    application, kAXFocusedUIElementAttribute as CFString, &value) == .success,
                let value, CFGetTypeID(value) == AXUIElementGetTypeID()
            else { return nil }
            // The Core Foundation type ID above establishes the opaque AX element type.
            let focused = unsafeBitCast(value, to: AXUIElement.self)
            AXUIElementSetMessagingTimeout(focused, 0.15)
            var selected: CFTypeRef?
            guard
                AXUIElementCopyAttributeValue(
                    focused, kAXSelectedTextAttribute as CFString, &selected) == .success
            else { return nil }
            return selected as? String
        }.value
    }
}
