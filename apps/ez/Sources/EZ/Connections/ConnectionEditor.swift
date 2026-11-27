import Combine
import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues

/// Owns one Settings form. AppModel and ConnectionSession own the setup transaction.
@MainActor final class ConnectionEditor: ObservableObject {
    enum Kind {
        case plan, openAIAPI, customEndpoint
    }

    struct Registration {
        let name: String
        var accountID: String?
        var confirmed = false
    }

    struct Draft {
        let id = "connection-" + UUID().uuidString.lowercased()
        let target: ConnectionDefinition?
        let kind: Kind
        var name: String
        var endpoint: String
        var accountID: String
        var registration: Registration?

        init(target: ConnectionDefinition?, kind: Kind) {
            self.target = target
            name = target?.name ?? ""
            endpoint = target?.endpoint ?? "https://api.openai.com/v1"
            accountID = target?.accountId ?? ""
            self.kind =
                target?.kind == .openAIAPI
                ? (endpoint == "https://api.openai.com/v1" ? .openAIAPI : .customEndpoint)
                : kind
        }

        func definition(profile: SaulAccount?, defaultPlanName: String) throws -> ConnectionDefinition {
            let key = target?.key ?? id
            if kind == .plan {
                guard let profile, profile.signedIn, profile.planEnabled else {
                    throw EZError("Sign in and allow plan use before saving this connection.")
                }
                let enteredName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                return ConnectionDefinition(
                    key: key, name: target?.name ?? (enteredName.isEmpty ? defaultPlanName : enteredName),
                    kind: .chatGPTPlan, accountId: profile.id)
            }
            return ConnectionDefinition(
                key: key, name: target?.name ?? name, kind: .openAIAPI,
                baseUrl: kind == .openAIAPI
                    ? "https://api.openai.com/v1"
                    : endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        }
    }

    @Published private(set) var draft: Draft?
    @Published var error: String?
    @Published var key = ""
    @Published var recoveryKey = ""
    @Published private var recoveryID: UUID?
    @Published private var signIn: (id: UUID, task: Task<Void, Never>)?

    var isOpen: Bool { draft != nil }
    var isSigningIn: Bool { signIn != nil }
    var name: String {
        get { draft?.name ?? "" }
        set { draft?.name = newValue }
    }
    var endpoint: String {
        get { draft?.endpoint ?? "" }
        set { draft?.endpoint = newValue }
    }
    var registrationConfirmed: Bool {
        get { draft?.registration?.confirmed ?? false }
        set { draft?.registration?.confirmed = newValue }
    }

    func recovery(in setups: [ConnectionSetup]) -> ConnectionSetup? {
        setups.first { $0.id == recoveryID } ?? setups.first
    }

    func review(_ setup: ConnectionSetup) {
        recoveryKey = ""
        recoveryID = setup.id
    }

    func setupsChanged(from previous: [ConnectionSetup], to current: [ConnectionSetup]) {
        let before = recovery(in: previous)
        let after = recovery(in: current)
        if before?.id != after?.id || (before?.phase != after?.phase && after?.phase == .settings) {
            recoveryKey = ""
        }
        if let draft,
            current.contains(where: {
                $0.definition.key == (draft.target?.key ?? draft.id) && $0.phase == .settings
            })
        {
            key = ""
        }
    }

    func eligibleProfiles(in model: AppModel) -> [SaulAccount] {
        model.profiles.filter { profile in
            !model.configuration.connections.contains {
                $0.accountId == profile.id && $0.key != draft?.target?.key
            }
        }
    }

    func selectedProfile(in model: AppModel) -> SaulAccount? {
        eligibleProfiles(in: model).first { $0.id == draft?.accountID }
    }

    func defaultPlanName(in model: AppModel) -> String {
        ConnectionDefinition.nextName("ChatGPT plan", among: model.configuration.connections)
    }

    func open(_ connection: ConnectionDefinition?, kind: Kind = .plan, using model: AppModel) {
        if let pending = model.session.pendingSetups.first(where: { $0.definition.key == connection?.key }) {
            review(pending)
            return
        }
        close()
        let next = Draft(target: connection, kind: kind)
        draft = next
        guard next.kind == .plan, model.allowsExternalServices else { return }
        let draftID = next.id
        Task { [weak self] in
            do {
                try await model.loadConnectionAccounts()
            } catch {
                guard let self, draft?.id == draftID else { return }
                self.error = error.localizedDescription
            }
        }
    }

    func selectAccount(_ id: String) {
        draft?.accountID = id
        if draft?.registration?.accountID != id { draft?.registration = nil }
        error = nil
    }

    func prepareRegistration() {
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
        draft?.registration = Registration(name: "Saul \(suffix)")
        error = nil
    }

    func discardRegistration() {
        draft?.registration = nil
        error = nil
    }

    func cancelSignIn() { signIn?.task.cancel() }

    func close() {
        cancelSignIn()
        signIn = nil
        clearForm()
    }

    private func clearForm() {
        draft = nil
        key = ""
        recoveryKey = ""
        error = nil
    }

    @discardableResult
    func signIn(using model: AppModel, suggestedAppName: String? = nil) -> Task<Void, Never>? {
        guard let draft, draft.kind == .plan else { return nil }
        let profile = selectedProfile(in: model)
        let consent = suggestedAppName == nil && profile?.signedIn == true && profile?.planEnabled == false
        let accountID = draft.target?.accountId ?? draft.accountID
        let target = draft.target
        return startSignIn { editor in
            do {
                guard
                    let id = try await model.signInConnection(
                        accountID: accountID, previous: target, suggestedAppName: suggestedAppName,
                        consent: consent),
                    !Task.isCancelled
                else { return }
                if let suggestedAppName {
                    editor.draft?.registration = Registration(name: suggestedAppName, accountID: id)
                }
                editor.draft?.accountID = id
                let ready = editor.selectedProfile(in: model).map { $0.signedIn && $0.planEnabled } == true
                if let target, target.accountId != nil, ready {
                    editor.clearForm()
                    await model.refreshConnection(target)
                } else if !ready {
                    editor.error = "ChatGPT plan use is still disabled for this account."
                }
            } catch {
                guard editor.draft?.id == draft.id else { return }
                if suggestedAppName != nil { editor.draft?.registration = nil }
                guard !Task.isCancelled else { return }
                editor.error = error.localizedDescription
                try? await model.loadConnectionAccounts()
            }
        }
    }

    func save(using model: AppModel) async {
        guard let draft else { return }
        error = nil
        let definition: ConnectionDefinition
        do {
            definition = try draft.definition(
                profile: selectedProfile(in: model), defaultPlanName: defaultPlanName(in: model))
        } catch {
            self.error = error.localizedDescription
            return
        }
        let suppliedKey = draft.kind == .plan ? nil : key
        let confirmedName = draft.registration?.confirmed == true ? draft.registration?.name : nil
        do {
            try await model.saveConnection(
                definition, previous: draft.target, key: suppliedKey, confirmedAppName: confirmedName)
            if self.draft?.id == draft.id { clearForm() }
        } catch {
            guard self.draft?.id == draft.id else { return }
            if let pending = model.session.pendingSetups.first(where: { $0.definition.key == definition.key })
            {
                clearForm()
                review(pending)
            }
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func continueSetup(
        _ pending: ConnectionSetup, requiresKey: Bool, repair: ConnectionSession.SetupRepairChoice?,
        using model: AppModel
    ) -> Task<Void, Never>? {
        let suppliedKey = requiresKey ? recoveryKey : nil
        let selectedRecovery = recoveryID
        let work: @MainActor (ConnectionEditor) async -> Void = { editor in
            do {
                if let repair {
                    try await model.repairConnectionSetup(pending.id, choice: repair, key: suppliedKey)
                } else {
                    try await model.resumeConnectionSetup(pending.id, phase: pending.phase, key: suppliedKey)
                }
                if !Task.isCancelled, editor.draft == nil, editor.recoveryID == selectedRecovery {
                    editor.clearForm()
                }
            } catch {
                if !Task.isCancelled, editor.draft == nil, editor.recoveryID == selectedRecovery {
                    editor.error = error.localizedDescription
                }
            }
        }
        if repair == .signIn || repair == .enablePlan {
            return startSignIn(work)
        }
        error = nil
        return Task { await work(self) }
    }

    @discardableResult
    private func startSignIn(_ work: @escaping @MainActor (ConnectionEditor) async -> Void)
        -> Task<Void, Never>?
    {
        guard signIn == nil else { return nil }
        error = nil
        let id = UUID()
        let task = Task { [weak self] in
            guard let self else { return }
            defer { if signIn?.id == id { signIn = nil } }
            guard !Task.isCancelled else { return }
            await work(self)
        }
        signIn = (id, task)
        return task
    }
}
