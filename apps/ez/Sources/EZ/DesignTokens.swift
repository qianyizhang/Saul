// Generated from DESIGN.md · SHA-256 79adffced3c8b15580e957eaabce3b69922f38ce02dde17f32d4cdcc372ed0db. Do not edit.
import SwiftUI

enum DesignTokens {
    static let `primary` = Color(
        nsColor: NSColor(name: "Little Clarity.primary") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.43137254901960786, green: 0.7607843137254902, blue: 0.6313725490196078,
                    alpha: 1)
            }
            return NSColor(
                srgbRed: 0.1607843137254902, green: 0.43137254901960786, blue: 0.34901960784313724, alpha: 1)
        })
    static let `primaryHover` = Color(
        nsColor: NSColor(name: "Little Clarity.primary-hover") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.5176470588235295, green: 0.8196078431372549, blue: 0.6941176470588235, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.12549019607843137, green: 0.33725490196078434, blue: 0.25882352941176473, alpha: 1)
        })
    static let `onPrimary` = Color(
        nsColor: NSColor(name: "Little Clarity.on-primary") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.0784313725490196, green: 0.1450980392156863, blue: 0.11372549019607843,
                    alpha: 1)
            }
            return NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        })
    static let `canvas` = Color(
        nsColor: NSColor(name: "Little Clarity.canvas") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.11764705882352941, green: 0.11764705882352941, blue: 0.11764705882352941,
                    alpha: 1)
            }
            return NSColor(
                srgbRed: 0.9803921568627451, green: 0.9803921568627451, blue: 0.9686274509803922, alpha: 1)
        })
    static let `surface` = Color(
        nsColor: NSColor(name: "Little Clarity.surface") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.14901960784313725, green: 0.14901960784313725, blue: 0.14901960784313725,
                    alpha: 1)
            }
            return NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        })
    static let `subtle` = Color(
        nsColor: NSColor(name: "Little Clarity.subtle") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.18823529411764706, green: 0.18823529411764706, blue: 0.18823529411764706,
                    alpha: 1)
            }
            return NSColor(
                srgbRed: 0.9411764705882353, green: 0.9450980392156862, blue: 0.9215686274509803, alpha: 1)
        })
    static let `ink` = Color(
        nsColor: NSColor(name: "Little Clarity.ink") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.9098039215686274, green: 0.9098039215686274, blue: 0.9098039215686274, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.1411764705882353, green: 0.15294117647058825, blue: 0.13333333333333333, alpha: 1)
        })
    static let `muted` = Color(
        nsColor: NSColor(name: "Little Clarity.muted") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.7098039215686275, green: 0.7098039215686275, blue: 0.7098039215686275, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.3843137254901961, green: 0.40784313725490196, blue: 0.36470588235294116, alpha: 1)
        })
    static let `line` = Color(
        nsColor: NSColor(name: "Little Clarity.line") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.2823529411764706, green: 0.2823529411764706, blue: 0.2823529411764706, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.8431372549019608, green: 0.8627450980392157, blue: 0.8196078431372549, alpha: 1)
        })
    static let `wash` = Color(
        nsColor: NSColor(name: "Little Clarity.wash") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.1450980392156863, green: 0.23921568627450981, blue: 0.19215686274509805,
                    alpha: 1)
            }
            return NSColor(
                srgbRed: 0.9176470588235294, green: 0.9490196078431372, blue: 0.9254901960784314, alpha: 1)
        })
    static let `danger` = Color(
        nsColor: NSColor(name: "Little Clarity.danger") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.9529411764705882, green: 0.6549019607843137, blue: 0.6196078431372549, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.6392156862745098, green: 0.19215686274509805, blue: 0.16470588235294117, alpha: 1)
        })
    static let `dangerWash` = Color(
        nsColor: NSColor(name: "Little Clarity.danger-wash") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.2784313725490196, green: 0.16470588235294117, blue: 0.1568627450980392,
                    alpha: 1)
            }
            return NSColor(srgbRed: 1, green: 0.9411764705882353, blue: 0.9294117647058824, alpha: 1)
        })
    static let `warning` = Color(
        nsColor: NSColor(name: "Little Clarity.warning") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.8862745098039215, green: 0.7411764705882353, blue: 0.5137254901960784, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.5019607843137255, green: 0.32941176470588235, blue: 0.09019607843137255, alpha: 1)
        })
    static let `warningWash` = Color(
        nsColor: NSColor(name: "Little Clarity.warning-wash") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.25098039215686274, green: 0.20392156862745098, blue: 0.1450980392156863,
                    alpha: 1)
            }
            return NSColor(
                srgbRed: 0.9686274509803922, green: 0.9372549019607843, blue: 0.8745098039215686, alpha: 1)
        })
    static let `windowBlue` = Color(
        nsColor: NSColor(name: "Little Clarity.window-blue") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.5568627450980392, green: 0.7411764705882353, blue: 0.8980392156862745, alpha: 1
                )
            }
            return NSColor(srgbRed: 0.20784313725490197, green: 0.41568627450980394, blue: 0.6, alpha: 1)
        })
    static let `windowViolet` = Color(
        nsColor: NSColor(name: "Little Clarity.window-violet") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.7686274509803922, green: 0.6392156862745098, blue: 0.8862745098039215, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.47058823529411764, green: 0.3254901960784314, blue: 0.6039215686274509, alpha: 1)
        })
    static let `windowRose` = Color(
        nsColor: NSColor(name: "Little Clarity.window-rose") { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(
                    srgbRed: 0.8941176470588236, green: 0.6274509803921569, blue: 0.7137254901960784, alpha: 1
                )
            }
            return NSColor(
                srgbRed: 0.6392156862745098, green: 0.30980392156862746, blue: 0.4117647058823529, alpha: 1)
        })
    static let `subject` = Font.system(size: 24, weight: .medium, design: .serif)
    static let `body` = Font.system(size: 15, weight: .regular, design: .default)
    static let `control` = Font.system(size: 14, weight: .medium, design: .default)
    static let `caption` = Font.system(size: 12, weight: .regular, design: .default)
    static let `radiusControl`: CGFloat = 8
    static let `radiusPanel`: CGFloat = 12
    static let `radiusComposer`: CGFloat = 14
    static let `radiusPill`: CGFloat = 9999
    static let `spaceXs`: CGFloat = 4
    static let `spaceSm`: CGFloat = 8
    static let `spaceMd`: CGFloat = 12
    static let `spaceLg`: CGFloat = 16
    static let `spaceXl`: CGFloat = 24
    static let `spaceReading`: CGFloat = 32
}
