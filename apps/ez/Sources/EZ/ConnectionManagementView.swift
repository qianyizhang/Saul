import EZCore
import SaulNativeValues
import SwiftUI

struct ConnectionManagementView: View {
    enum Action: String {
        case rename = "Rename connection"
        case move = "Move presets"
        case delete = "Delete connection"
    }

    let action: Action
    let connection: ConnectionDefinition
    let configuration: Configuration
    let disabled: Bool
    let commit: (ConnectionChange) throws -> Void
    let close: () -> Void
    let openMove: () -> Void
    @State private var name: String
    @State private var destination = ""
    @State private var selected: Set<UUID> = []
    @State private var error: String?

    init(
        action: Action, connection: ConnectionDefinition, configuration: Configuration, disabled: Bool,
        commit: @escaping (ConnectionChange) throws -> Void, close: @escaping () -> Void,
        openMove: @escaping () -> Void
    ) {
        self.action = action
        self.connection = connection
        self.configuration = configuration
        self.disabled = disabled
        self.commit = commit
        self.close = close
        self.openMove = openMove
        _name = State(initialValue: connection.name)
    }

    private var linked: [ModelPreset] { configuration.presets.filter { $0.connectionKey == connection.key } }
    private var destinations: [ConnectionDefinition] {
        configuration.connections.filter { candidate in
            candidate.key != connection.key && linked.contains { candidate.supportsMove(of: $0) }
        }
    }
    private var selectedDestination: ConnectionDefinition? { destinations.first { $0.key == destination } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(action.rawValue).font(.headline)
            Text(connection.managementLabel).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            switch action {
            case .rename:
                LabeledContent("Connection name") {
                    TextField("Connection name", text: $name).labelsHidden().textFieldStyle(.roundedBorder)
                }
            case .move:
                moveFields
            case .delete:
                if linked.isEmpty {
                    Text(
                        "This removes the saved connection from Settings. Its credentials are managed separately."
                    )
                } else {
                    Text("Move these presets before deleting this connection.")
                    ForEach(linked) { preset in Text(preset.name).font(.callout) }
                }
            }
            HStack {
                switch action {
                case .rename:
                    Button("Save name") { save(.rename(name)) }.buttonStyle(.borderedProminent)
                        .disabled(
                            disabled || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || name == connection.name)
                case .move:
                    Button("Move presets") { save(.move(destination: destination, presets: selected)) }
                        .buttonStyle(.borderedProminent).disabled(
                            disabled || selected.isEmpty || selectedDestination == nil)
                case .delete:
                    if linked.isEmpty {
                        Button("Delete connection", role: .destructive) { save(.delete) }
                            .disabled(disabled)
                    } else {
                        Button("Move presets", action: openMove).buttonStyle(.borderedProminent)
                    }
                }
                Button("Cancel", action: close)
            }
        }
        .frame(maxWidth: 480, alignment: .leading)
    }

    @ViewBuilder private var moveFields: some View {
        if destinations.isEmpty {
            Text(
                linked.isEmpty
                    ? "No presets use this connection." : "Add a compatible destination connection first.")
        } else {
            Picker("Move to", selection: $destination) {
                Text("Choose a connection").tag("")
                ForEach(destinations) { candidate in
                    Text(candidate.managementLabel).tag(candidate.key)
                }
            }
            .onChange(of: destination) { _, _ in
                selected = Set(linked.filter { selectedDestination?.supportsMove(of: $0) == true }.map(\.id))
            }
            if let selectedDestination {
                Text("Presets to move").font(AppStyle.caption)
                ForEach(linked) { preset in
                    let supported = selectedDestination.supportsMove(of: preset)
                    Toggle(
                        supported ? preset.name : "\(preset.name) · Unsupported by this destination",
                        isOn: Binding(
                            get: { supported && selected.contains(preset.id) },
                            set: { value in
                                if value { selected.insert(preset.id) } else { selected.remove(preset.id) }
                            })
                    ).disabled(!supported)
                }
            }
            Text(
                "Moved presets use the destination’s billing. Their models and options stay saved and may need review."
            )
            .font(AppStyle.caption).foregroundStyle(.secondary)
        }
    }
    private func save(_ change: ConnectionChange) {
        do {
            try commit(change)
            close()
        } catch { self.error = error.localizedDescription }
    }
}
