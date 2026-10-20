import Foundation

public struct CheckCase {
    public let name: String
    let file: StaticString
    let line: UInt
    let body: @MainActor (URL) async throws -> Void

    public init(
        _ name: String, file: StaticString = #filePath, line: UInt = #line,
        _ body: @escaping @MainActor (URL) async throws -> Void
    ) {
        self.name = name
        self.file = file
        self.line = line
        self.body = body
    }
}

public enum CheckRunner {
    /// Cases run serially, each with disposable storage. Ordinary failures never skip later cases.
    @MainActor public static func run(
        _ cases: [CheckCase], arguments: [String] = Array(CommandLine.arguments.dropFirst()),
        report: (String) -> Void = { print($0) }
    ) async -> Int32 {
        var filter: String?
        var list = false
        var reverse = false
        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--list": list = true
            case "--reverse": reverse = true
            case "--filter":
                index += 1
                guard index < arguments.count, !arguments[index].isEmpty else {
                    report("--filter requires a nonempty case-name substring")
                    return 2
                }
                filter = arguments[index]
            default:
                report("Unknown argument: \(arguments[index]). Use --list, --filter <substring>, --reverse.")
                return 2
            }
            index += 1
        }
        guard Set(cases.map(\.name)).count == cases.count else {
            report("Duplicate check names")
            return 2
        }
        var selected = cases.filter { test in
            filter.map { test.name.localizedCaseInsensitiveContains($0) } ?? true
        }
        guard !selected.isEmpty else {
            report("No checks matched")
            return 2
        }
        if reverse { selected.reverse() }
        if list {
            for test in selected { report(test.name) }
            return 0
        }
        var failures = 0
        for test in selected {
            // A non-cooperative suspended task cannot be safely abandoned in this process.
            // Stop once with its case name rather than hanging or leaking it into later cases.
            let watchdog = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
            watchdog.schedule(deadline: .now() + 15)
            watchdog.setEventHandler {
                fputs("FAIL \(test.name): exceeded 15-second case timeout\n", stderr)
                exit(1)
            }
            watchdog.resume()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
                "ez-check-\(UUID())")
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try await test.body(directory)
                try FileManager.default.removeItem(at: directory)
                report("PASS \(test.name)")
            } catch {
                failures += 1
                let detail = (error as? CheckFailure)?.description ?? "\(test.file):\(test.line): \(error)"
                report("FAIL \(test.name): \(detail)")
                try? FileManager.default.removeItem(at: directory)
            }
            watchdog.cancel()
        }
        report(
            "\(selected.count - failures)/\(selected.count) checks passed; \(failures) failed. Offline fixtures only."
        )
        return failures == 0 ? 0 : 1
    }
}
