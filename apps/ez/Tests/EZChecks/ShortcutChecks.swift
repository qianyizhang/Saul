import EZCheckSupport
import EZCore
import Foundation

@MainActor func shortcutChecks() -> [CheckCase] {
    [
        CheckCase("shortcuts: defaults, modifiers, conflicts, and reserved editing keys") { _ in
            var shortcuts = LookupShortcuts()
            try shortcuts.validate()
            try expectEqual(
                shortcuts.binding(for: .nextRecipe), .init(key: "]", modifiers: 9),
                "Shortcut contract mismatch")
            try expectEqual(
                shortcuts.binding(for: .lastRecipe), .init(key: "9"), "Shortcut contract mismatch")
            shortcuts.overrides[LookupCommand.stop.rawValue] = .init(key: "n")
            try expectThrows(EZError.self, matching: { $0.message.contains("already assigned") }) {
                try shortcuts.validate()
            }
            for binding in [
                LookupKeyBinding(key: "q"), .init(key: "c"), .init(key: "v"), .init(key: ","),
                .init(key: "w"), .init(key: "space", modifiers: 6), .init(key: "a", modifiers: 0),
                .init(key: "x", modifiers: 8), .init(key: "left"), .init(key: "a", modifiers: 4),
            ] {
                try expectThrows(EZError.self) { try binding.validate() }
            }
            try LookupKeyBinding(key: "right", modifiers: 3).validate()
            try LookupKeyBinding.unassigned.validate()
        },
        CheckCase("shortcuts: overrides and cleared bindings persist owner-only") { directory in
            let store = LookupShortcutsStore(directory: directory)
            try expectEqual(try store.load(), LookupShortcuts(), "Shortcut contract mismatch")
            var shortcuts = LookupShortcuts()
            shortcuts.overrides[LookupCommand.newLookup.rawValue] = .init(key: "t")
            shortcuts.overrides[LookupCommand.send.rawValue] = .unassigned
            try store.save(shortcuts)
            try expectEqual(try store.load(), shortcuts, "Shortcut contract mismatch")
            let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
            try expectEqual(
                (attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600, "Shortcut contract mismatch")
            let bytes = try Data(contentsOf: store.url)
            shortcuts.overrides[LookupCommand.stop.rawValue] = .init(key: "t")
            try expectThrows(EZError.self) { try store.save(shortcuts) }
            try expectEqual(try Data(contentsOf: store.url), bytes, "Shortcut contract mismatch")
        },
        CheckCase("shortcuts: corrupt and unsupported files are preserved") { directory in
            let store = LookupShortcutsStore(directory: directory)
            let corrupt = Data("{broken".utf8)
            try corrupt.write(to: store.url)
            try expectThrows(DecodingError.self) { _ = try store.load() }
            try expectEqual(try Data(contentsOf: store.url), corrupt, "Shortcut contract mismatch")
            var future = LookupShortcuts()
            future.schemaVersion = 2
            try JSONEncoder().encode(future).write(to: store.url)
            try expectThrows(EZError.self) { _ = try store.load() }
            let blocked = directory.appendingPathComponent("file")
            try Data().write(to: blocked)
            try expectThrows(NSError.self, matching: isFileError) {
                try LookupShortcutsStore(directory: blocked).save(LookupShortcuts())
            }
        },
    ]
}
