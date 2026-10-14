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
            for key in ["tools", "max_output_tokens", "temperature", "previous_response_id", "metadata"] {
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
            ) { updates.append($0) }
            try expect(result.completed && result.text == "Hello 你好", "URLSession SSE completion failed")
            try expect(
                updates.first == "Hello 你好" && updates.last == result.text, "Visible streamed text lost")
            try expect(fixture.requests.count == 1, "Stream made unexpected requests")
        },
    ]
}
