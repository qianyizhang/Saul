import EZCore
import Foundation
import SaulNativeValues

@MainActor final class ConnectionSetupStore {
    private(set) var records: [ConnectionSetup] = []
    var repairs: [UUID: ConnectionSession.SetupRepairChoice] = [:]
    var onChange: (() -> Void)?

    func load(in directory: URL) throws {
        var current: [String: ConnectionSetup] = [:]
        let legacy = legacyURL(in: directory)
        if FileManager.default.fileExists(atPath: legacy.path) {
            let setup = try read(legacy)
            current[setup.definition.key] = setup
        }
        let root = setupDirectory(in: directory)
        if FileManager.default.fileExists(atPath: root.path) {
            for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            where file.pathExtension == "json" {
                let setup = try read(file)
                guard file.lastPathComponent == setup.definition.key + ".json" else {
                    throw EZError("Unfinished connection setup could not be read.")
                }
                current[setup.definition.key] = setup
            }
        }
        let sorted = current.values.sorted { $0.definition.key < $1.definition.key }
        if records != sorted {
            records = sorted
            repairs = repairs.filter { id, _ in sorted.contains(where: { $0.id == id }) }
            onChange?()
        }
    }

    func remember(_ setup: ConnectionSetup, in directory: URL) throws {
        let root = setupDirectory(in: directory)
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try AtomicFile.write(
            JSONEncoder().encode(setup), to: setupURL(setup.definition.key, in: directory))
        let legacy = legacyURL(in: directory)
        if FileManager.default.fileExists(atPath: legacy.path),
            try read(legacy).definition.key == setup.definition.key
        {
            try FileManager.default.removeItem(at: legacy)
        }
        try load(in: directory)
    }

    func require(_ id: UUID, phase: ConnectionSetup.Phase, in directory: URL) throws -> ConnectionSetup {
        try load(in: directory)
        guard let record = records.first(where: { $0.id == id }), record.phase == phase else {
            throw EZError("This setup has changed or finished. Reopen Connections to review it.")
        }
        return record
    }

    func remove(_ setup: ConnectionSetup, in directory: URL) throws {
        _ = try require(setup.id, phase: setup.phase, in: directory)
        let legacy = legacyURL(in: directory)
        if FileManager.default.fileExists(atPath: legacy.path),
            try read(legacy).definition.key == setup.definition.key
        {
            try FileManager.default.removeItem(at: legacy)
        }
        let url = setupURL(setup.definition.key, in: directory)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try load(in: directory)
    }

    func setRepair(_ repair: ConnectionSession.SetupRepairChoice?, for id: UUID) {
        repairs[id] = repair
        onChange?()
    }

    private func read(_ url: URL) throws -> ConnectionSetup {
        let setup = try JSONDecoder().decode(ConnectionSetup.self, from: Data(contentsOf: url))
        try ConnectionDefinition.validate([setup.definition])
        if let previous = setup.previous { try ConnectionDefinition.validate([previous]) }
        guard setup.protectionVersion == nil || setup.protectionVersion == 1 else {
            throw EZError("Unfinished connection setup requires a newer version of EZ.")
        }
        return setup
    }

    private func legacyURL(in directory: URL) -> URL {
        directory.appendingPathComponent("connection-setup.json")
    }

    private func setupDirectory(in directory: URL) -> URL {
        directory.appendingPathComponent("connection-setups", isDirectory: true)
    }

    private func setupURL(_ key: String, in directory: URL) -> URL {
        setupDirectory(in: directory).appendingPathComponent(key + ".json")
    }
}
