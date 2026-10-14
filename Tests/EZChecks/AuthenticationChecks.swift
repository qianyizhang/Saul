import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func authenticationChecks() -> [CheckCase] {
    [
        CheckCase("auth: credential restore suspends without publishing partial state") { _ in
            let pending = PendingCredentialRead()
            let fixture = HTTPFixture { _ in throw CheckFailure("Credential restore unexpectedly used HTTP") }
            defer { fixture.close() }
            let auth = ChatGPTAuth(storage: DeferredCredentials(pending: pending), session: fixture.session)
            let task = Task { try await auth.load() }
            do {
                try await pending.started.wait()
                try expect(auth.selected == nil, "Restore published partial state")
            } catch {
                task.cancel()
                await pending.finish(AuthState())
                _ = try? await task.value
                throw error
            }
            await pending.finish(credentialState())
            try await task.value
            try expect(auth.selected?.clientID == "issued", "Restore changed selection")
        },
        CheckCase("auth: cancelled credential restore leaves account state untouched") { _ in
            let pending = PendingCredentialRead()
            let fixture = HTTPFixture { _ in throw CheckFailure("Credential restore unexpectedly used HTTP") }
            defer { fixture.close() }
            let auth = ChatGPTAuth(storage: DeferredCredentials(pending: pending), session: fixture.session)
            let task = Task { try await auth.load() }
            do { try await pending.started.wait() } catch {
                task.cancel()
                await pending.finish(AuthState())
                _ = try? await task.value
                throw error
            }
            task.cancel()
            await pending.finish(credentialState())
            try await expectAsyncThrows(CancellationError.self) { _ = try await task.value }
            try expect(auth.selected == nil, "Cancelled restore applied state")
        },
        CheckCase("auth: credential read failure preserves loaded account") { _ in
            let store = MemoryCredentials(credentialState())
            let fixture = HTTPFixture { _ in throw CheckFailure("Credential restore unexpectedly used HTTP") }
            defer { fixture.close() }
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            store.failReads = true
            try await expectAsyncThrows(
                EZError.self, matching: { $0.message == "Synthetic credential read failure" }
            ) {
                try await auth.load()
            }
            try expect(auth.selected?.clientID == "issued", "Failed restore erased account")
            try expect(store.writes == 0, "Restore wrote credentials")
        },
        CheckCase("auth: overlapping callers share one refresh and persist rotation with scopes") { _ in
            let fixture = HTTPFixture { request in
                try expect(request.url?.path == "/api/accounts/oauth/token", "Wrong token route")
                try expect(request.httpMethod == "POST", "Wrong token method")
                return HTTPReply(refreshReply, held: true)
            }
            defer { fixture.close() }
            let original = credentialState()
            let store = MemoryCredentials(original)
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            let first = Task { try await auth.accessToken() }
            do { try await fixture.received.wait() } catch {
                first.cancel()
                fixture.close()
                _ = try? await first.value
                throw error
            }
            let entered = CheckSignal()
            let second = Task {
                Task { await entered.signal() }
                return try await auth.accessToken()
            }
            // The second MainActor task runs into accessToken's first suspension before
            // this task resumes; the first HTTP response is still held by the fixture.
            let tokens: (String, String)
            do {
                try await entered.wait()
                fixture.release()
                tokens = try await (first.value, second.value)
            } catch {
                first.cancel()
                second.cancel()
                fixture.close()
                _ = try? await first.value
                _ = try? await second.value
                throw error
            }
            try expect(tokens.0 == "new" && tokens.1 == "new", "Refresh returned wrong tokens")
            try expectEqual(fixture.requests.count, 1, "Concurrent callers sent multiple refreshes")
            try expectEqual(store.writes, 1, "Rotation was not persisted exactly once")
            let saved = store.value.selected?.credentials
            try expect(saved?.accessToken == "new" && saved?.refreshToken == "rotated", "Saved rotation lost")
            try expectEqual(
                saved?.scopes, original.selected?.credentials?.scopes, "Omitted scopes were not retained")
            try expect(
                saved?.idToken == "old-id" && saved?.canUsePlan == true, "Saved identity/permission lost")
            let restored = ChatGPTAuth(storage: store, session: fixture.session)
            try await restored.load()
            let restoredToken = try await restored.accessToken()
            try expect(restoredToken == "new", "Reload did not use saved access token")
            try expect(fixture.requests.count == 1, "Reload unnecessarily refreshed")
        },
        CheckCase("auth: transient refresh failure preserves all saved credentials") { _ in
            let fixture = HTTPFixture { _ in HTTPReply(#"{"detail":"Temporarily unavailable"}"#, status: 503)
            }
            defer { fixture.close() }
            let original = credentialState()
            let store = MemoryCredentials(original)
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            try await expectAsyncThrows(APIError.self, matching: { $0.status == 503 }) {
                _ = try await auth.accessToken()
            }
            try expectEqual(
                try credentialBytes(store.value), try credentialBytes(original),
                "Transient failure changed saved credentials")
            try expectEqual(
                try credentialBytes(auth.state), try credentialBytes(original),
                "Transient failure changed account state")
        },
        CheckCase("auth: terminal refresh failure clears credentials but retains registration") { _ in
            let fixture = HTTPFixture { _ in
                HTTPReply(#"{"error":"invalid_grant","error_description":"Revoked"}"#, status: 400)
            }
            defer { fixture.close() }
            let store = MemoryCredentials(credentialState())
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            try await expectAsyncThrows(
                APIError.self, matching: { $0.status == 400 && $0.code == "invalid_grant" }
            ) { _ = try await auth.accessToken() }
            try expect(
                store.writes == 1 && store.value.selected?.credentials == nil,
                "Terminal failure did not persist removal")
            try expect(
                store.value.selected?.clientID == "issued" && auth.selected?.clientID == "issued",
                "Registration lost")
            try expect(auth.selected?.credentials == nil, "Visible credentials remain")
        },
        CheckCase("auth: failed rotation write does not publish unpersisted credentials") { _ in
            let fixture = HTTPFixture { _ in HTTPReply(refreshReply) }
            defer { fixture.close() }
            let original = credentialState()
            let store = MemoryCredentials(original)
            store.failWrites = true
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            try await expectAsyncThrows(
                EZError.self, matching: { $0.message == "Synthetic credential write failure" }
            ) { _ = try await auth.accessToken() }
            try expectEqual(store.writes, 0, "Failed save reported successful writes")
            try expectEqual(
                try credentialBytes(store.value), try credentialBytes(original),
                "Failed save changed stored credentials")
            try expectEqual(
                try credentialBytes(auth.state), try credentialBytes(original),
                "Unpersisted credentials published")
        },
        CheckCase("auth: missing plan permission refuses inference without HTTP") { _ in
            let fixture = HTTPFixture { _ in throw CheckFailure("Missing permission reached HTTP") }
            defer { fixture.close() }
            let store = MemoryCredentials(credentialState(scopes: ["openid"]))
            let auth = ChatGPTAuth(storage: store, session: fixture.session)
            try await auth.load()
            try await expectAsyncThrows(
                EZError.self, matching: { $0.message.contains("Enable ChatGPT plan usage") }
            ) { _ = try await auth.accessToken() }
            try expect(
                fixture.requests.isEmpty && store.writes == 0, "Permission rejection made side effects")
        },
    ]
}
