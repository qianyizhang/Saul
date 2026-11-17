import Foundation
import SaulCredentialClient
import SaulNativeValues
import SaulTestSupport

@testable import SaulCredentialOwner

@MainActor func illustrationChecks() -> [CheckCase] {
  [
    CheckCase("image input: edit transport carries exact bytes and normal Draw stays generation") {
      _ in
      let image = try ImageAttachment(data: fixturePNG, name: "sketch.png")
      let fixture = HTTPFixture { request in
        try expectEqual(
          request.url?.path, "/v1/images/edits", "Input image used generation endpoint")
        try expect(
          request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix(
            "multipart/form-data; boundary=") == true, "Edit is not multipart")
        let body = requestData(request)
        try expect(body.range(of: fixturePNG) != nil, "Image bytes changed")
        let header = String(decoding: body, as: UTF8.self)
        try expect(
          header.contains("name=\"image[]\"; filename=\"input\"")
            && header.contains("Content-Type: image/png"), "Image part missing")
        try expect(header.contains("caption 中文"), "Instructions lost")
        return HTTPReply("{\"data\":[{\"b64_json\":\"\(fixturePNG.base64EncodedString())\"}]}")
      }
      defer { fixture.close() }
      let result = try await ImagesClient(session: fixture.session).generate(
        ImageGenerationRequest(prompt: "caption 中文", model: "gpt-image-2.6-flare", image: image),
        apiKey: "sk-synthetic")
      try expectEqual(result, fixturePNG, "Edited PNG changed")
      try expectEqual(fixture.requests.count, 1, "Edit automatically retried")
    },
    CheckCase("illustration: one explicit image request with frozen context and API credentials") {
      _ in
      let input = ImageGenerationRequest(
        prompt: "Illustrate roots exchanging nutrients. 中文\nWatercolor",
        model: "gpt-image-2.6-flare")
      let fixture = HTTPFixture { request in
        try expectEqual(
          request.url?.absoluteString, "https://api.openai.com/v1/images/generations",
          "Wrong endpoint")
        try expectEqual(request.httpMethod, "POST", "Wrong method")
        try expectEqual(
          request.value(forHTTPHeaderField: "Authorization"), "Bearer sk-offline-fixture",
          "Wrong credential owner")
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
          stream.open()
          defer { stream.close() }
          var buffer = [UInt8](repeating: 0, count: 4096)
          while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
          }
        }
        guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw CheckFailure("Missing image request body") }
        try expectEqual(body["prompt"] as? String, input.prompt, "Prompt changed")
        try expectEqual(body["model"] as? String, input.model, "Model changed")
        try expectEqual(body["n"] as? Int, 1, "More than one image requested")
        try expectEqual(body["quality"] as? String, "low", "Unexpected quality")
        try expectEqual(body["output_format"] as? String, "png", "Wrong image format")
        for key in ["response_format", "stream", "tools", "store", "user"] {
          try expect(body[key] == nil, "Unexpected image field: \(key)")
        }
        let output = try JSONSerialization.data(withJSONObject: [
          "data": [["b64_json": fixturePNG.base64EncodedString()]]
        ])
        var reply = HTTPReply("")
        reply.chunks = [output]
        reply.headers = ["Content-Type": "application/json"]
        return reply
      }
      defer { fixture.close() }
      let output = try await ImagesClient(session: fixture.session).generate(
        input, apiKey: "sk-offline-fixture")
      try expectEqual(output, fixturePNG, "PNG changed")
      try expectEqual(fixture.requests.count, 1, "Image request retried")
    },
    CheckCase("illustration: GIF output preserves animation bytes and rejects edits before HTTP") {
      _ in
      let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../contracts/fixtures/animation.gif")
      let gif = try Data(contentsOf: url)
      let fixture = HTTPFixture { request in
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
          stream.open()
          defer { stream.close() }
          var buffer = [UInt8](repeating: 0, count: 4096)
          while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
          }
        }
        guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          throw CheckFailure("Missing GIF request body")
        }
        try expectEqual(body["model"] as? String, "gpt-image-2.6-flare", "Wrong default model")
        try expectEqual(body["output_format"] as? String, "gif", "GIF format not sent")
        try expect(body["stream"] == nil, "GIF cannot stream")
        return HTTPReply("{\"data\":[{\"b64_json\":\"\(gif.base64EncodedString())\"}]}")
      }
      defer { fixture.close() }
      let client = ImagesClient(session: fixture.session)
      let output = try await client.generate(
        ImageGenerationRequest(
          prompt: "A waving tree, looping", model: "gpt-image-2.6-flare", outputFormat: "gif"),
        apiKey: "sk-fixture")
      try expectEqual(output, gif, "Animation bytes changed")
      for input in [
        ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.5-flare", outputFormat: "gif"),
        ImageGenerationRequest(
          prompt: "Tree", model: "gpt-image-2.6-flare", outputFormat: "gif",
          image: try ImageAttachment(data: fixturePNG, name: "source.png")),
      ] {
        try await expectAsyncThrows(NativeValueError.self) {
          _ = try await client.generate(input, apiKey: "sk-fixture")
        }
      }
      let malformed = try JSONSerialization.data(withJSONObject: [
        "data": [["b64_json": fixturePNG.base64EncodedString()]]
      ])
      try expectThrows(OwnerRequestError.self) {
        _ = try ImagesClient.decodeImage(malformed, format: "gif")
      }
      try expectEqual(fixture.requests.count, 1, "Invalid GIF request reached HTTP or retried")
    },
    CheckCase("illustration: invalid context options and credentials block before HTTP") { _ in
      let fixture = HTTPFixture { _ in throw CheckFailure("Invalid request reached HTTP") }
      defer { fixture.close() }
      let client = ImagesClient(session: fixture.session)
      for input in [
        ImageGenerationRequest(prompt: " \n", model: "gpt-image-2.6-flare"),
        ImageGenerationRequest(
          prompt: String(repeating: "x", count: 32_001), model: "gpt-image-2.6-flare"),
        ImageGenerationRequest(
          prompt: String(repeating: "e\u{301}", count: 16_001), model: "gpt-image-2.6-flare"),
        ImageGenerationRequest(prompt: "Tree", model: ""),
        ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare", size: "4096x4096"),
        ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare", quality: "max"),
      ] {
        try await expectAsyncThrows(NativeValueError.self) {
          _ = try await client.generate(input, apiKey: "sk-test")
        }
      }
      try await expectAsyncThrows(OwnerRequestError.self) {
        _ = try await client.generate(
          ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare"),
          apiKey: "key\r\nInjected: header")
      }
      try expectEqual(fixture.requests.count, 0, "Validation sent a request")
    },
    CheckCase("illustration: rejected requests give safe recovery and never retry") { _ in
      for (status, code, hint) in [
        (401, "invalid_api_key", "Replace"), (403, "denied", "verification"),
        (429, "insufficient_quota", "billing"), (400, "moderation_blocked", "Revise"),
        (404, "model_not_found", "model"), (503, "unavailable", "later"),
      ] {
        let fixture = HTTPFixture { _ in
          HTTPReply(
            "{\"error\":{\"code\":\"\(code)\",\"message\":\"secret sk-test\"}}", status: status)
        }
        defer { fixture.close() }
        let error = try await expectAsyncThrows(OwnerRequestError.self) {
          _ = try await ImagesClient(session: fixture.session).generate(
            ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare"),
            apiKey: "sk-test")
        }
        try expect(error.localizedDescription.contains(hint), "Missing actionable recovery")
        try expect(!error.localizedDescription.contains("sk-test"), "Provider echoed a credential")
        try expectEqual(fixture.requests.count, 1, "Failure retried")
      }
    },
    CheckCase("illustration: missing malformed non-PNG and oversized responses fail") { _ in
      for object: [String: Any] in [
        ["data": []], ["data": [["b64_json": "invalid"]]],
        ["data": [["b64_json": Data("not PNG".utf8).base64EncodedString()]]],
        ["data": [["url": "https://example.com/image.png"]]],
        [
          "data": [
            ["b64_json": fixturePNG.base64EncodedString()],
            ["b64_json": fixturePNG.base64EncodedString()],
          ]
        ],
      ] {
        let data = try JSONSerialization.data(withJSONObject: object)
        try expectThrows(OwnerRequestError.self) { _ = try ImagesClient.decodePNG(data) }
      }
      let fixture = HTTPFixture { _ in
        var reply = HTTPReply("{}")
        reply.headers["Content-Length"] = "30000000"
        return reply
      }
      defer { fixture.close() }
      try await expectAsyncThrows(
        OwnerRequestError.self, matching: { $0.localizedDescription.contains("too large") }
      ) {
        _ = try await ImagesClient(session: fixture.session).generate(
          ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare"), apiKey: "sk-test")
      }
    },
    CheckCase("illustration: cancelling an in-flight HTTP request never publishes an image") { _ in
      let fixture = HTTPFixture { _ in HTTPReply("{}", held: true) }
      defer { fixture.close() }
      let task = Task {
        try await ImagesClient(session: fixture.session).generate(
          ImageGenerationRequest(prompt: "Tree", model: "gpt-image-2.6-flare"), apiKey: "sk-test")
      }
      try await fixture.received.wait()
      task.cancel()
      do {
        _ = try await task.value
        throw CheckFailure("Cancelled request succeeded")
      } catch is CancellationError {
      } catch let error as URLError where error.code == .cancelled {
      }
      try expectEqual(fixture.requests.count, 1, "Cancellation retried")
    },
  ]
}
