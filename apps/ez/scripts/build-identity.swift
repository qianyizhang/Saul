import CryptoKit
import Foundation

// Matches scripts/build-identity.mts. This keeps standalone EZ builds Apple-only.
func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func sourceFingerprint(root: URL) throws -> String {
    let manager = FileManager.default
    let selection = root.appendingPathComponent("apps/ez/build-inputs.json")
    let inputs = try JSONDecoder().decode([String].self, from: Data(contentsOf: selection))
    var records: [String: String] = [:]
    func visit(_ name: String) throws {
        guard !name.isEmpty, !name.hasPrefix("/"), !name.split(separator: "/").contains(".."),
            !name.contains("\n"), !name.contains("\0")
        else { throw CocoaError(.fileReadInvalidFileName) }
        let path = root.appendingPathComponent(name)
        let attributes: [FileAttributeKey: Any]
        do { attributes = try manager.attributesOfItem(atPath: path.path) } catch {
            if (error as NSError).code == NSFileReadNoSuchFileError {
                records[name] = "missing"
                return
            }
            throw error
        }
        if attributes[.type] as? FileAttributeType == .typeDirectory {
            records[name + "/"] = "directory"
            for child in try manager.contentsOfDirectory(atPath: path.path).sorted() {
                try visit(name + "/" + child)
            }
        } else if attributes[.type] as? FileAttributeType == .typeSymbolicLink {
            let target = path.resolvingSymlinksInPath()
            let prefix = root.path + "/"
            let targetAttributes = try manager.attributesOfItem(atPath: target.path)
            guard target.path.hasPrefix(prefix), targetAttributes[.type] as? FileAttributeType == .typeRegular
            else {
                throw CocoaError(.fileReadUnsupportedScheme)
            }
            let targetName = String(target.path.dropFirst(prefix.count))
            records[name] = try "link:\(targetName):\(digest(Data(contentsOf: target)))"
        } else if attributes[.type] as? FileAttributeType == .typeRegular {
            records[name] = try digest(Data(contentsOf: path))
        } else {
            throw CocoaError(.fileReadUnsupportedScheme)
        }
    }
    for input in inputs { try visit(input) }
    let canonical = records.keys.sorted().map { "\($0)\0\(records[$0]!)\n" }.joined()
    return digest(Data(canonical.utf8))
}

struct BuildInfo: Codable {
    let format: Int
    let app: String
    let version: String
    let source: String
    let toolchain: String
    let build: String
}

let arguments = CommandLine.arguments
guard arguments.count == 4, ["prepare", "verify"].contains(arguments[1]) else {
    fatalError("Usage: build-identity.swift prepare|verify REPOSITORY OUTPUT")
}
let root = URL(fileURLWithPath: arguments[2]).standardizedFileURL.resolvingSymlinksInPath()
let output = URL(fileURLWithPath: arguments[3])
let source = try sourceFingerprint(root: root)
if arguments[1] == "verify" {
    let info = try JSONDecoder().decode(BuildInfo.self, from: Data(contentsOf: output))
    guard info.source == source else {
        fatalError("EZ source changed during the build; rebuild before delivery.")
    }
} else {
    let plist = try Data(contentsOf: root.appendingPathComponent("apps/ez/Resources/Info.plist"))
    let values = try PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any]
    guard let version = values?["CFBundleShortVersionString"] as? String else {
        fatalError("Missing EZ version.")
    }
    guard
        version.range(
            of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil,
        version.split(separator: ".").allSatisfy({ (Int($0) ?? 65536) <= 65535 })
    else { fatalError("Invalid EZ version: use three integers from 0 to 65535.") }
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["swift", "--version"]
    process.standardOutput = pipe
    try process.run()
    let toolchain = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { fatalError("Cannot read Swift toolchain identity.") }
    let info = BuildInfo(
        format: 1, app: "ez", version: version, source: source, toolchain: toolchain,
        build: digest(Data("ez\0\(version)\0\(source)\0\(toolchain)".utf8)))
    try JSONEncoder().encode(info).write(to: output, options: .atomic)
}
