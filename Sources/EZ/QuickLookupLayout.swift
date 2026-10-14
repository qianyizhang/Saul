import Foundation

/// Keep the controls and a usable answer area visible at the smallest panel size.
struct QuickLookupLayout: Equatable {
    static let defaultWidth: CGFloat = 460
    static let minimumWidth: CGFloat = 420
    let fieldCount: Int
    let showsNotice: Bool
    let showsAnswer: Bool

    static func inputHeight(fieldCount: Int) -> CGFloat { min(150, CGFloat(fieldCount) * 50) }

    var minimumHeight: CGFloat {
        max(
            200,
            150 + Self.inputHeight(fieldCount: fieldCount)
                + (showsNotice ? 98 : 0) + (showsAnswer ? 90 : 0))
    }
    var preferredHeight: CGFloat { minimumHeight + (showsAnswer ? 140 : 0) }
}
