import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func responsesChecks() -> [CheckCase] {
    [
        CheckCase("responses: Responses request stays within plan preview contract") { _ in
            let entry = HistoryEntry(
                mode: .ask, query: "hi", model: "test", effort: "low", requestedServiceTier: "fast")
            let body = ResponsesClient.requestBody(entry: entry)
            try expect(
                body["store"] as? Bool == false && body["stream"] as? Bool == true,
                "Required streaming/nonstorage flags")
            try expect(body["service_tier"] as? String == "priority", "Fast must map to public priority tier")
            try expect(body["input"] is [[String: String]], "Input must be an array")
            for key in [
                "tools", "max_output_tokens", "temperature", "previous_response_id", "metadata", "include",
            ] {
                try expect(body[key] == nil, "Unsupported field: \(key)")
            }
        },
        CheckCase("responses: SSE framing and completed text") { _ in
            var parser = SSEParser()
            var result = ResponseAccumulator()
            let events = [
                #"{"type":"response.output_text.delta","delta":"你好"}"#,
                #"{"type":"response.completed","response":{"status":"completed","service_tier":"default","output":[{"content":[{"type":"output_text","text":"你好!"}]}]}}"#,
            ]
            for event in events {
                try expect(parser.feed("data: " + event) == nil, "Premature event")
                guard let payload = parser.feed("") else {
                    throw CheckFailure("SSE event did not flush at a blank line")
                }
                try result.consume(payload)
            }
            try result.requireCompleted()
            try expect(
                result.text == "你好!" && result.actualServiceTier == "default", "Terminal text/tier mismatch")
        },
        CheckCase("responses: usage and first-text timing exclude metadata and empty deltas") { _ in
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.created"}"#.utf8), elapsedSeconds: 0.1)
            try result.consume(
                Data(#"{"type":"response.output_text.delta","delta":""}"#.utf8), elapsedSeconds: 0.2)
            try expect(result.metrics.timeToFirstTokenSeconds == nil, "Metadata counted as first text")
            try result.consume(
                Data(#"{"type":"response.output_text.delta","delta":"Hi"}"#.utf8), elapsedSeconds: 1)
            try result.consume(
                Data(#"{"type":"response.output_text.delta","delta":"!"}"#.utf8), elapsedSeconds: 2)
            try result.consume(
                Data(
                    #"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":42,"output_tokens":100,"output_tokens_details":{"reasoning_tokens":60}}}}"#
                        .utf8), elapsedSeconds: 4)
            try result.requireCompleted()
            try expectEqual(result.metrics.inputTokens, 42, "inputTokens mismatch")
            try expectEqual(result.metrics.reasoningTokens, 60, "reasoningTokens mismatch")
            try expectEqual(result.metrics.responseTokens, 40, "responseTokens mismatch")
            try expectEqual(result.metrics.timeToFirstTokenSeconds, 1, "timeToFirstTokenSeconds mismatch")
            try expectEqual(result.metrics.tokensPerSecond, 40.0 / 3, "tokensPerSecond mismatch")
        },
        CheckCase("responses: unknown usage is distinct from zero and final-only text has no TTFT") { _ in
            var result = ResponseAccumulator()
            try result.consume(
                Data(
                    #"{"type":"response.completed","response":{"status":"completed","output":[{"content":[{"type":"output_text","text":"Final only"}]}],"usage":{"input_tokens":0,"output_tokens":5}}}"#
                        .utf8), elapsedSeconds: 2)
            try result.requireCompleted()
            try expectEqual(result.metrics.inputTokens, 0, "inputTokens mismatch")
            try expect(
                result.metrics.reasoningTokens == nil && result.metrics.responseTokens == nil,
                "Unknown reasoning assumed zero")
            try expect(result.metrics.timeToFirstTokenSeconds == nil, "Terminal event invented TTFT")
            var missing = ResponseAccumulator()
            try missing.consume(
                Data(#"{"type":"response.completed","response":{"status":"completed"}}"#.utf8))
            try expect(
                missing.metrics.inputTokens == nil && missing.metrics.tokensPerSecond == nil,
                "Missing usage invented")
        },
        CheckCase("responses: incomplete stream retains terminal usage and first-text timing") { _ in
            var result = ResponseAccumulator()
            try result.consume(
                Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8), elapsedSeconds: 0.5)
            try expectThrows(APIError.self) {
                try result.consume(
                    Data(
                        #"{"type":"response.incomplete","response":{"usage":{"input_tokens":10,"output_tokens":20,"output_tokens_details":{"reasoning_tokens":0}}}}"#
                            .utf8), elapsedSeconds: 2)
            }
            try expect(!result.completed && result.text == "partial", "Incomplete answer became successful")
            try expectEqual(result.metrics.responseTokens, 20, "responseTokens mismatch")
            try expectEqual(result.metrics.timeToFirstTokenSeconds, 0.5, "timeToFirstTokenSeconds mismatch")
            try expectEqual(result.metrics.tokensPerSecond, 20.0 / 1.5, "tokensPerSecond mismatch")
        },
        CheckCase("responses: malformed usage cannot create negative or nonfinite rates") { _ in
            var result = ResponseAccumulator()
            try result.consume(
                Data(
                    #"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":true,"output_tokens":-1,"output_tokens_details":{"reasoning_tokens":"bad"}}}}"#
                        .utf8), elapsedSeconds: 0)
            try expect(
                result.metrics.inputTokens == nil && result.metrics.outputTokens == nil,
                "Invalid counts accepted")
            try expect(
                result.metrics.reasoningTokens == nil && result.metrics.tokensPerSecond == nil,
                "Invalid usage produced metrics")
            try expect(
                ResponseMetrics(reasoningTokens: 3, outputTokens: 2).responseTokens == nil,
                "Negative response count")
            try expect(
                ResponseMetrics(
                    reasoningTokens: 0, outputTokens: 2, timeToFirstTokenSeconds: 1,
                    durationSeconds: .infinity
                ).tokensPerSecond == nil,
                "Nonfinite rate")
            try expect(
                ResponseMetrics(
                    reasoningTokens: 0, outputTokens: 2, timeToFirstTokenSeconds: 0, durationSeconds: 0
                ).tokensPerSecond == nil,
                "Zero duration rate")
        },
        CheckCase("responses: throughput starts after TTFT and excludes reasoning tokens") { _ in
            let metrics = ResponseMetrics(
                reasoningTokens: 950, outputTokens: 1000, timeToFirstTokenSeconds: 10, durationSeconds: 11)
            try expectEqual(metrics.tokensPerSecond, 50, "Thinking or wait time distorted answer speed")
            try expect(
                ResponseMetrics(reasoningTokens: 0, outputTokens: 100, durationSeconds: 5).tokensPerSecond
                    == nil, "Missing TTFT invented speed")
            try expect(
                ResponseMetrics(outputTokens: 100, timeToFirstTokenSeconds: 1, durationSeconds: 5)
                    .tokensPerSecond == nil, "Missing reasoning count invented response speed")
            for first in [-1.0, 5, 6, .infinity, .nan] {
                try expect(
                    ResponseMetrics(
                        reasoningTokens: 0, outputTokens: 100, timeToFirstTokenSeconds: first,
                        durationSeconds: 5
                    ).tokensPerSecond == nil, "Invalid post-TTFT interval produced speed")
            }
            try expectEqual(
                ResponseMetrics(
                    reasoningTokens: 0, outputTokens: 0, timeToFirstTokenSeconds: 0, durationSeconds: 1
                ).tokensPerSecond, 0, "Reported zero became unknown")
        },
        CheckCase("responses: reasoning activity follows item events without retaining encrypted content") {
            _ in
            var result = ResponseAccumulator()
            try expect(
                result.activity == .waiting && result.activity.showsThinkingLight,
                "Initial wait must show activity")
            try result.consume(
                Data(
                    #"{"type":"response.output_item.added","item":{"type":"reasoning","encrypted_content":"synthetic-opaque"}}"#
                        .utf8))
            try expect(
                result.activity == .thinking && result.text.isEmpty,
                "Reasoning event must not become answer text")
            try result.consume(
                Data(#"{"type":"response.output_item.done","item":{"type":"reasoning"}}"#.utf8))
            try expect(
                result.activity == .thinking, "Reasoning completion reset confirmed thinking to waiting")
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":""}"#.utf8))
            try expect(result.activity == .thinking, "Empty delta stopped the light")
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"Answer"}"#.utf8))
            try expect(
                result.activity == .responding && !result.activity.showsThinkingLight,
                "Text must stop thinking light")
            try result.consume(
                Data(#"{"type":"response.output_item.added","item":{"type":"reasoning"}}"#.utf8))
            try expect(
                result.activity == .responding, "Interleaved reasoning restarted visual activity after text")
            try result.consume(Data(#"{"type":"response.completed","response":{"status":"completed"}}"#.utf8))
            try expect(
                result.activity == .finished && !result.activity.showsThinkingLight,
                "Completion left light active")
            try expect(result.text == "Answer", "Reasoning content leaked into answer")
            for type in ["response.failed", "response.incomplete", "error"] {
                var failed = ResponseAccumulator()
                try failed.consume(
                    Data(#"{"type":"response.output_item.added","item":{"type":"reasoning"}}"#.utf8))
                try expectThrows(APIError.self) { try failed.consume(Data("{\"type\":\"\(type)\"}".utf8)) }
                try expect(failed.activity == .finished, "Terminal error left light active")
            }
        },
        CheckCase("responses: refusal text stops thinking and records first visible text") { _ in
            var result = ResponseAccumulator()
            try result.consume(
                Data(#"{"type":"response.output_item.added","item":{"type":"reasoning"}}"#.utf8))
            try result.consume(
                Data(#"{"type":"response.refusal.delta","delta":"I cannot"}"#.utf8), elapsedSeconds: 0.75)
            try expect(
                result.text == "I cannot" && result.activity == .responding,
                "Refusal text left thinking active or hid partial answer")
            try expectEqual(result.metrics.timeToFirstTokenSeconds, 0.75, "Refusal TTFT missing")
            try result.consume(
                Data(
                    #"{"type":"response.completed","response":{"status":"completed","output":[{"content":[{"type":"refusal","refusal":"I cannot help with that."}]}]}}"#
                        .utf8), elapsedSeconds: 1)
            try result.requireCompleted()
            try expect(
                result.text == "I cannot help with that." && result.activity == .finished,
                "Final refusal did not replace partial text")
        },
        CheckCase("responses: partial stream cannot complete") { _ in
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8))
            try expectThrows(EZError.self, matching: { $0.message.contains("before response.completed") }) {
                try result.requireCompleted()
            }
            try expect(result.text == "partial" && !result.completed, "Partial text/status lost")
        },
        CheckCase("responses: failed event preserves partial text and usage error") { _ in
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8))
            try expectThrows(
                APIError.self,
                matching: { $0.code == "subscription_sharing_usage_limit_exceeded" && $0.message == "Limit" }
            ) {
                try result.consume(
                    Data(
                        #"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit"}}}"#
                            .utf8))
            }
            try expect(result.text == "partial" && !result.completed, "Failure discarded partial text")
        },
        CheckCase("responses: incomplete event preserves partial text and reason") { _ in
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8))
            try expectThrows(APIError.self, matching: { $0.message == "Response incomplete: limit" }) {
                try result.consume(
                    Data(
                        #"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"limit"}}}"#
                            .utf8))
            }
            try expect(
                result.text == "partial" && !result.completed, "Incomplete event discarded partial text")
        },
        CheckCase("responses: malformed JSON preserves partial text") { _ in
            var result = ResponseAccumulator()
            try result.consume(Data(#"{"type":"response.output_text.delta","delta":"partial"}"#.utf8))
            try expectThrows(NSError.self, matching: { $0.domain == NSCocoaErrorDomain && $0.code == 3840 }) {
                try result.consume(Data("broken".utf8))
            }
            try expect(
                result.text == "partial" && !result.completed, "Malformed event changed partial result")
        },
        CheckCase("responses: structured and admission HTTP errors") { _ in
            let response = HTTPURLResponse(
                url: URL(string: "https://api.openai.com/v1/responses")!, statusCode: 403, httpVersion: nil,
                headerFields: ["x-request-id": "trace"])!
            let error = APIError.parse(
                data: Data(#"{"detail":"Region unavailable"}"#.utf8), response: response)
            try expect(
                error.message == "Region unavailable" && error.requestID == "trace", "Admission error lost")
        },
        CheckCase("responses: transport interruption publishes partial metrics before throwing") { _ in
            let fixture = HTTPFixture { _ in
                HTTPReply("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
            }
            defer { fixture.close() }
            var last: ResponseAccumulator?
            try await expectAsyncThrows(
                EZError.self, matching: { $0.message.contains("before response.completed") }
            ) {
                _ = try await ResponsesClient(session: fixture.session).stream(
                    entry: HistoryEntry(
                        mode: .ask, query: "hi", model: "test", effort: "", requestedServiceTier: nil),
                    token: "synthetic"
                ) { last = $0 }
            }
            try expect(last?.text == "partial" && last?.completed == false, "Interrupted answer lost")
            try expect(
                last?.metrics.timeToFirstTokenSeconds != nil && last?.metrics.durationSeconds != nil,
                "Interrupted timing lost")
            try expect(last?.metrics.outputTokens == nil, "Interrupted usage invented")
        },
        CheckCase("responses: URLSession delivers fragmented Unicode SSE through completion") { _ in
            let fixture = HTTPFixture { request in
                try expect(request.url?.path == "/v1/responses", "Wrong route")
                try expect(
                    request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic",
                    "Wrong credential")
                let stream =
                    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello 你好\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n"
                var reply = HTTPReply("")
                reply.chunks = Data(stream.utf8).map { Data([$0]) }
                return reply
            }
            defer { fixture.close() }
            var updates: [String] = []
            let result = try await ResponsesClient(session: fixture.session).stream(
                entry: HistoryEntry(
                    mode: .ask, query: "hello", model: "test", effort: "low", requestedServiceTier: nil),
                token: "synthetic"
            ) { updates.append($0.text) }
            try expect(result.completed && result.text == "Hello 你好", "URLSession SSE completion failed")
            try expect(
                updates.first == "Hello 你好" && updates.last == result.text, "Visible streamed text lost")
            try expect(fixture.requests.count == 1, "Stream made unexpected requests")
            try expect(
                result.metrics.timeToFirstTokenSeconds != nil && result.metrics.durationSeconds != nil,
                "HTTP stream timing missing")
        },
    ]
}
