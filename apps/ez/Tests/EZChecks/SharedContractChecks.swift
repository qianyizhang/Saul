import EZCheckSupport
import Foundation

@testable import EZCore

private struct TemplateContract: Decodable {
    struct Valid: Decodable {
        let name: String
        let template: String
        let values: [String: String]
        let output: String
    }
    struct Missing: Decodable {
        let template: String
        let values: [String: String]
    }
    let version: Int
    let valid: [Valid]
    let invalid: [String]
    let missing: [Missing]
}

@MainActor func sharedContractChecks() -> [CheckCase] {
    [
        CheckCase("shared contract: literal preparation, invalid syntax and missing inputs") { _ in
            let fixture = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/templates.json")
                .standardizedFileURL
            let contract = try JSONDecoder().decode(
                TemplateContract.self, from: Data(contentsOf: fixture))
            try expectEqual(contract.version, 1, "Unknown shared template contract")
            for entry in contract.valid {
                try expectEqual(
                    try PromptTemplate(entry.template).render(entry.values), entry.output, entry.name)
            }
            for template in contract.invalid {
                try expectThrows(EZError.self) { _ = try PromptTemplate(template) }
            }
            for entry in contract.missing {
                try expectThrows(EZError.self) {
                    _ = try PromptTemplate(entry.template).render(entry.values)
                }
            }
        }
    ]
}
