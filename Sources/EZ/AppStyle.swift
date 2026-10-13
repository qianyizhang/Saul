import SwiftUI

enum AppStyle {
    static let accent = Color(
        nsColor: NSColor(name: "EZAccent") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(calibratedRed: 0.43, green: 0.76, blue: 0.63, alpha: 1)
            }
            return NSColor(calibratedRed: 0.16, green: 0.43, blue: 0.35, alpha: 1)
        })
}
