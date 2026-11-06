// Generated from design/symbols.json. Run pnpm design:generate; do not edit.
import SwiftUI

enum ControlSymbol: String, CaseIterable {
    case copy
    case copied
    case send
    case refresh
    case reload
    case hideSidebar
    case showSidebar
    case openWorkspace
    case run
    case stop
    case reuse
    case regenerate
    case more
    case details
    case close
    case download
    var label: String {
        switch self {
        case .copy: return "Copy"
        case .copied: return "Copied"
        case .send: return "Send"
        case .refresh: return "Refresh"
        case .reload: return "Reload"
        case .hideSidebar: return "Hide sidebar"
        case .showSidebar: return "Show sidebar"
        case .openWorkspace: return "Open main window"
        case .run: return "Run"
        case .stop: return "Stop"
        case .reuse: return "Reuse"
        case .regenerate: return "Regenerate"
        case .more: return "More"
        case .details: return "Details"
        case .close: return "Close"
        case .download: return "Download"
        }
    }
    var systemImage: String {
        switch self {
        case .copy: return "doc.on.doc"
        case .copied: return "checkmark"
        case .send: return "paperplane"
        case .refresh: return "arrow.triangle.2.circlepath"
        case .reload: return "arrow.clockwise"
        case .hideSidebar: return "sidebar.left"
        case .showSidebar: return "sidebar.left"
        case .openWorkspace: return "macwindow"
        case .run: return "play.fill"
        case .stop: return "stop.fill"
        case .reuse: return "arrow.uturn.backward"
        case .regenerate: return "sparkles"
        case .more: return "ellipsis"
        case .details: return "info.circle"
        case .close: return "xmark"
        case .download: return "arrow.down.to.line"
        }
    }
}
