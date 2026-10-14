import EZCheckSupport
import Foundation

struct HTTPReply {
    var status = 200
    var chunks: [Data]
    var held = false
    var headers = ["Content-Type": "text/event-stream", "x-request-id": "test-request"]
    init(_ text: String, status: Int = 200, held: Bool = false) {
        self.status = status
        chunks = [Data(text.utf8)]
        self.held = held
    }
}

/// URLProtocol requires class-level routing. Only this locked registry is shared;
/// each ephemeral session has a unique route, immutable handler, and request log.
final class HTTPFixture: @unchecked Sendable {
    private static let registryLock = NSLock()
    private static var registry: [String: HTTPFixture] = [:]
    private let id = UUID().uuidString
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private var pending: [(FixtureProtocol, HTTPReply)] = []
    private var released = false
    private var closed = false
    private let handler: (URLRequest) throws -> HTTPReply
    let received = CheckSignal()
    let session: URLSession
    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
    init(_ handler: @escaping (URLRequest) throws -> HTTPReply) {
        self.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureProtocol.self]
        configuration.httpAdditionalHeaders = ["X-EZ-Test-Fixture": id]
        configuration.timeoutIntervalForRequest = 3
        configuration.timeoutIntervalForResource = 5
        session = URLSession(configuration: configuration)
        Self.registryLock.lock()
        Self.registry[id] = self
        Self.registryLock.unlock()
    }
    fileprivate static func find(_ request: URLRequest) -> HTTPFixture? {
        guard let id = request.value(forHTTPHeaderField: "X-EZ-Test-Fixture") else { return nil }
        registryLock.lock()
        defer { registryLock.unlock() }
        return registry[id]
    }
    fileprivate func respond(to transport: FixtureProtocol) {
        defer { Task { await received.signal() } }
        lock.lock()
        recorded.append(transport.request)
        lock.unlock()
        do {
            let reply = try handler(transport.request)
            lock.lock()
            guard !closed else {
                lock.unlock()
                transport.fail(URLError(.cancelled))
                return
            }
            let shouldHold = reply.held && !released
            if shouldHold { pending.append((transport, reply)) }
            lock.unlock()
            if !shouldHold { transport.deliver(reply) }
        } catch { transport.fail(error) }
    }
    func release() {
        lock.lock()
        let held = pending
        pending.removeAll()
        released = true
        lock.unlock()
        for (transport, reply) in held { transport.deliver(reply) }
    }
    func close() {
        lock.lock()
        closed = true
        let held = pending
        pending.removeAll()
        lock.unlock()
        Self.registryLock.lock()
        Self.registry.removeValue(forKey: id)
        Self.registryLock.unlock()
        for (transport, _) in held { transport.fail(URLError(.cancelled)) }
        session.invalidateAndCancel()
    }
}

private final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    private let queue = DispatchQueue(label: "ez-check-http")
    private var stopped = false
    // Intercept even unregistered requests so fixture mistakes cannot reach the network.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let fixture = HTTPFixture.find(request) else {
            fail(CheckFailure("Request has no registered offline fixture"))
            return
        }
        fixture.respond(to: self)
    }
    override func stopLoading() { queue.async { self.stopped = true } }
    func deliver(_ reply: HTTPReply) {
        queue.async {
            guard !self.stopped else { return }
            let response = HTTPURLResponse(
                url: self.request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
                headerFields: reply.headers)!
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            for chunk in reply.chunks { self.client?.urlProtocol(self, didLoad: chunk) }
            self.client?.urlProtocolDidFinishLoading(self)
            self.stopped = true
        }
    }
    func fail(_ error: Error) {
        queue.async {
            guard !self.stopped else { return }
            // URLSession bridges errors through NSError and can discard Swift-only
            // descriptions. Preserve assertion locations across that boundary.
            let original = error as NSError
            var info = original.userInfo
            info[NSLocalizedDescriptionKey] =
                (error as? CheckFailure)?.description
                ?? (error as? LocalizedError)?.errorDescription ?? original.localizedDescription
            self.client?.urlProtocol(
                self, didFailWithError: NSError(domain: original.domain, code: original.code, userInfo: info))
            self.stopped = true
        }
    }
}
