import Foundation
import SaulNativeValues

public struct ModelOption: Identifiable {
    public struct Effort {
        public let reasoningEffort: String
        public let description: String
    }
    public let id: String
    public let model: String
    public let displayName: String
    public let defaultReasoningEffort: String
    public let supportedReasoningEfforts: [Effort]
    public let isDefault: Bool
    public let fastTier: String?
    public var quickEffort: String {
        ["none", "minimal", "low"].first(where: { choice in
            supportedReasoningEfforts.contains { $0.reasoningEffort == choice }
        })
            ?? (supportedReasoningEfforts.contains { $0.reasoningEffort == defaultReasoningEffort }
                ? defaultReasoningEffort : supportedReasoningEfforts.first?.reasoningEffort ?? "")
    }
    public init(connectionModel: ConnectionModel) {
        id = connectionModel.id
        model = connectionModel.id
        displayName = connectionModel.name
        defaultReasoningEffort = connectionModel.defaultEffort
        supportedReasoningEfforts = connectionModel.efforts.map {
            Effort(reasoningEffort: $0, description: "")
        }
        isDefault = connectionModel.isDefault == true
        fastTier = connectionModel.fastTier
    }
}
