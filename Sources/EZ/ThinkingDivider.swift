import EZCore
import SwiftUI

/// A quiet moving light on the answer boundary; it never changes layout or intercepts input.
struct ThinkingDivider: View {
    let activity: ResponseActivity?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.thinkingLightMotionDisabled) private var motionDisabled

    private var active: Bool { activity?.showsThinkingLight == true }
    private var lightColor: Color { activity == .thinking ? AppStyle.accent : AppStyle.waitingActivity }
    private var label: String { activity == .thinking ? "Thinking…" : "Waiting for answer…" }

    var body: some View {
        Divider()
            .overlay {
                if active {
                    if reduceMotion || motionDisabled {
                        light(progress: 0.5)
                    } else {
                        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                            // A cosine turnaround keeps both ends smooth; one round trip takes 3.2 seconds.
                            let elapsed = context.date.timeIntervalSinceReferenceDate
                            let progress = (1 - cos(elapsed * .pi / 1.6)) / 2
                            light(progress: progress)
                        }
                    }
                }
            }
            .animation(reduceMotion || motionDisabled ? nil : .easeInOut(duration: 0.25), value: activity)
            .allowsHitTesting(false)
            .accessibilityHidden(!active)
            .accessibilityLabel(label)
            .help(active ? label : "")
    }

    private func light(progress: Double) -> some View {
        GeometryReader { geometry in
            let width = min(84, geometry.size.width * 0.24)
            let x = max(0, geometry.size.width - width) * progress
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [.clear, lightColor.opacity(0.8), lightColor, .clear],
                        startPoint: .leading, endPoint: .trailing)
                )
                .frame(width: width, height: 2)
                .shadow(color: lightColor.opacity(0.65), radius: 3)
                .offset(x: x, y: -0.5)
        }
    }
}

// Preview-only suppression composes with, and never disables, the system preference.
private struct ThinkingLightMotionDisabledKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var thinkingLightMotionDisabled: Bool {
        get { self[ThinkingLightMotionDisabledKey.self] }
        set { self[ThinkingLightMotionDisabledKey.self] = newValue }
    }
}
