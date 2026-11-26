import SaulNativeValues

extension ConnectionModel {
    public var quickEffort: String {
        ["none", "minimal", "low"].first(where: efforts.contains)
            ?? (efforts.contains(defaultEffort) ? defaultEffort : efforts.first ?? "")
    }
}
