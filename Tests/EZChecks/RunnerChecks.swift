import EZCheckSupport
import Foundation

@MainActor func runnerChecks() -> [CheckCase] {
    [
        CheckCase("runner: aggregates failures and isolates disposable directories") { _ in
            var directories: [URL] = []
            var reports: [String] = []
            let cases = [
                CheckCase("synthetic failure") { directory in
                    directories.append(directory)
                    try Data("fixture".utf8).write(to: directory.appendingPathComponent("marker"))
                    try expect(false, "synthetic assertion", file: "fixture.swift", line: 42)
                },
                CheckCase("later case") { directory in
                    directories.append(directory)
                    try expect(
                        !FileManager.default.fileExists(
                            atPath: directory.appendingPathComponent("marker").path), "Earlier storage leaked"
                    )
                },
            ]
            let status = await CheckRunner.run(cases, arguments: [], report: { reports.append($0) })
            try expect(
                status == 1 && reports.contains { $0.hasPrefix("PASS later case") },
                "Failure skipped later case or returned success")
            try expect(
                reports.contains { $0.contains("fixture.swift:42: synthetic assertion") },
                "Failure lost source location")
            try expect(directories.count == 2 && directories[0] != directories[1], "Cases shared directories")
            try expect(
                directories.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) },
                "Runner leaked temporary storage")
        },
        CheckCase("runner: filtering listing reverse order and invalid arguments") { _ in
            var ran: [String] = []
            var reports: [String] = []
            let cases = [
                CheckCase("alpha") { _ in ran.append("alpha") },
                CheckCase("beta") { _ in ran.append("beta") },
            ]
            let filtered = await CheckRunner.run(
                cases, arguments: ["--filter", "BETA"], report: { reports.append($0) })
            try expect(filtered == 0 && ran == ["beta"], "Filter ran wrong cases")
            ran = []
            reports = []
            let listed = await CheckRunner.run(
                cases, arguments: ["--list", "--reverse"], report: { reports.append($0) })
            try expect(
                listed == 0 && ran.isEmpty && reports == ["beta", "alpha"], "Listing ran cases or lost order")
            let reversed = await CheckRunner.run(cases, arguments: ["--reverse"], report: { _ in })
            try expect(reversed == 0 && ran == ["beta", "alpha"], "Reverse execution order wrong")
            for arguments in [["--filter", "missing"], ["--filter"], ["--unknown"]] {
                let status = await CheckRunner.run(cases, arguments: arguments, report: { _ in })
                try expect(status == 2, "Invalid selection returned success")
            }
        },
        CheckCase("runner: error assertions reject success wrong types and wrong details") { _ in
            struct Expected: Error {}
            struct Wrong: Error {}
            let mismatch = try expectThrows(CheckFailure.self) {
                try expectEqual(2, 1, "request count", file: "fixture.swift", line: 43)
            }
            try expect(
                mismatch.description.contains("fixture.swift:43: request count; expected 1, got 2"),
                "Equality failure lost location or values")
            try expectThrows(CheckFailure.self) { try expectThrows(Expected.self) {} }
            try expectThrows(CheckFailure.self) { try expectThrows(Expected.self) { throw Wrong() } }
            try expectThrows(CheckFailure.self) {
                try expectThrows(Expected.self, matching: { _ in false }) { throw Expected() }
            }
            try await expectAsyncThrows(CheckFailure.self) { try await expectAsyncThrows(Expected.self) {} }
            try await expectAsyncThrows(CheckFailure.self) {
                try await expectAsyncThrows(Expected.self) { throw Wrong() }
            }
            try await expectAsyncThrows(CheckFailure.self) {
                try await expectAsyncThrows(Expected.self, matching: { _ in false }) { throw Expected() }
            }
        },
        CheckCase("runner: simultaneous HTTP fixtures cannot overwrite each other") { _ in
            let first = HTTPFixture { _ in HTTPReply("first") }
            let second = HTTPFixture { _ in HTTPReply("second") }
            defer {
                first.close()
                second.close()
            }
            let url = URL(string: "https://fixture.invalid/same-route")!
            async let a = first.session.data(from: url)
            async let b = second.session.data(from: url)
            let results = try await (a, b)
            try expect(
                String(data: results.0.0, encoding: .utf8) == "first",
                "First fixture received another handler")
            try expect(
                String(data: results.1.0, encoding: .utf8) == "second",
                "Second fixture received another handler")
            try expect(first.requests.count == 1 && second.requests.count == 1, "Request logs shared")
        },
        CheckCase("runner: failed HTTP handlers wake observers and preserve their error") { _ in
            let fixture = HTTPFixture { _ in
                throw CheckFailure("Synthetic HTTP handler failure", file: "fixture.swift", line: 123)
            }
            defer { fixture.close() }
            let request = Task {
                try await fixture.session.data(from: URL(string: "https://fixture.invalid/error")!)
            }
            defer { request.cancel() }
            try await fixture.received.wait()
            try await expectAsyncThrows(
                NSError.self,
                matching: { $0.localizedDescription == "fixture.swift:123: Synthetic HTTP handler failure" }
            ) {
                _ = try await request.value
            }
            try expectEqual(fixture.requests.count, 1, "Failed request was not recorded")
        },
        CheckCase("runner: closing HTTP fixture cancels held requests") { _ in
            let fixture = HTTPFixture { _ in HTTPReply("held", held: true) }
            defer { fixture.close() }
            let request = Task {
                try await fixture.session.data(from: URL(string: "https://fixture.invalid/held")!)
            }
            defer { request.cancel() }
            try await fixture.received.wait()
            fixture.close()
            try await expectAsyncThrows(URLError.self, matching: { $0.code == .cancelled }) {
                _ = try await request.value
            }
        },
        CheckCase("runner: signals retain early notifications and respect cancellation") { _ in
            let signaled = CheckSignal()
            await signaled.signal()
            try await signaled.wait()
            let pending = CheckSignal()
            let waiter = Task { try await pending.wait() }
            waiter.cancel()
            try await expectAsyncThrows(CancellationError.self) { try await waiter.value }
            // Cancellation must not poison the signal for another waiter.
            await pending.signal()
            try await pending.wait()
        },
    ]
}
