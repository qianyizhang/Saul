import EZCore
import Foundation
import SaulNativeValues

/// Per-installation intent for an explicit continuation after a partial save.
struct ConnectionSetup: Codable, Equatable {
    enum Phase: String, Codable { case credential, settings }
    let id: UUID
    var phase: Phase
    let definition: ConnectionDefinition
    let previous: ConnectionDefinition?
    let confirmedName: String?
    var protectionVersion: Int? = nil

    func applying(to current: Configuration, allowApplied: Bool = false) throws -> Configuration {
        let existing = current.connections.first { $0.key == definition.key }
        guard existing == previous || (allowApplied && existing == definition) else {
            throw EZError("This connection changed. Review the saved connection before starting setup again.")
        }
        if let existing {
            guard existing.kind == definition.kind, existing.endpoint == definition.endpoint,
                existing.accountId == nil || existing.accountId == definition.accountId
            else { throw EZError("The connection’s account and endpoint are fixed. Add another connection.") }
        }
        if let account = definition.accountId,
            current.connections.contains(where: { $0.key != definition.key && $0.accountId == account })
        {
            throw EZError("This account already has a connection.")
        }
        var updated = current
        if let index = updated.connections.firstIndex(where: { $0.key == definition.key }) {
            updated.connections[index] = definition
        } else {
            updated.connections.append(definition)
        }
        try ConnectionDefinition.validate(updated.connections)
        return updated
    }
}
