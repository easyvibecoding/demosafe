import SwiftUI

/// Floating toolbox triggered by ⌃⌥Space hold gesture.
/// Shows filtered key list for quick paste access.
struct FloatingToolboxView: View {
    @EnvironmentObject var appState: AppState
    @State private var searchText = ""

    var body: some View {
        VStack(spacing: 8) {
            // Search field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Search keys...", text: $searchText)
                    .textFieldStyle(.plain)
            }
            .padding(8)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            // Filtered key list
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(filteredKeys(), id: \.key.id) { item in
                        ToolboxKeyRow(key: item.key, serviceName: item.serviceName)
                    }
                }
            }
            .frame(maxHeight: 200)

            // Hint
            HStack {
                Text("Hold ⌃⌥Space")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Spacer()
                Text("Release to dismiss")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
        .frame(width: 260)
        .background(.ultraThinMaterial)
        .cornerRadius(12)
        .shadow(radius: 8)
    }

    private struct KeyItem {
        let key: KeyEntry
        let serviceName: String
    }

    private func filteredKeys() -> [KeyItem] {
        let services = appState.vaultManager.getAllServices()
        var items: [KeyItem] = []

        for service in services {
            let keys = appState.vaultManager.getKeys(serviceId: service.id)
            for key in keys {
                items.append(KeyItem(key: key, serviceName: service.name))
            }
        }

        if searchText.isEmpty { return items }

        let query = searchText.lowercased()
        return items.filter {
            $0.key.label.lowercased().contains(query) ||
            $0.serviceName.lowercased().contains(query)
        }
    }
}

struct ToolboxKeyRow: View {
    @EnvironmentObject var appState: AppState
    let key: KeyEntry
    let serviceName: String

    var body: some View {
        Button(action: { appState.copyKey(keyId: key.id) }) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(key.label)
                        .font(.subheadline)
                    Text(serviceName)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text(appState.maskingCoordinator.maskedDisplay(keyId: key.id))
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
