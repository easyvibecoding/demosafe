import SwiftUI

/// Floating toolbox triggered by ⌃⌥Space hold gesture.
/// Shows filtered key list for quick paste access.
struct FloatingToolboxView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var toolboxState: ToolboxState

    var body: some View {
        VStack(spacing: 8) {
            // Search field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                Text(toolboxState.searchText.isEmpty ? "Type to search..." : toolboxState.searchText)
                    .foregroundColor(toolboxState.searchText.isEmpty ? .secondary : .primary)
                    .font(.system(.body, design: .monospaced))
                Spacer()
                if !toolboxState.searchText.isEmpty {
                    Text("\(toolboxState.filteredKeys.count)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.15))
                        .cornerRadius(4)
                }
            }
            .padding(8)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            // Key list
            // Key list — fixed height to prevent layout collapse
            ScrollViewReader { proxy in
                ScrollView {
                    if toolboxState.filteredKeys.isEmpty {
                        Text("No keys found")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    } else {
                        VStack(spacing: 2) {
                            ForEach(Array(toolboxState.filteredKeys.enumerated()), id: \.element.id) { offset, item in
                                ToolboxKeyRow(
                                    key: item.key,
                                    serviceName: item.serviceName,
                                    displayIndex: item.index,
                                    isSelected: toolboxState.isLocked && offset == toolboxState.selectedIndex
                                )
                                .id(offset)
                            }
                        }
                    }
                }
                .frame(height: 200)
                .onChange(of: toolboxState.selectedIndex) {
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo(toolboxState.selectedIndex, anchor: .center)
                    }
                }
            }

            // Status hint
            HStack {
                if toolboxState.isLocked {
                    Text("↑↓ Navigate")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("⏎ Copy  ⎋ Dismiss")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    Text("Hold ⌃⌥Space + type")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("Release to select")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(12)
        .frame(width: 280)
        .background(.ultraThinMaterial)
        .cornerRadius(12)
        .shadow(radius: 8)
    }
}

struct ToolboxKeyRow: View {
    @EnvironmentObject var appState: AppState
    let key: KeyEntry
    let serviceName: String
    let displayIndex: Int
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 6) {
            // Index badge
            Text("\(displayIndex)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(width: 18, alignment: .center)

            VStack(alignment: .leading, spacing: 1) {
                Text(key.label)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(serviceName)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text(appState.maskingCoordinator.maskedDisplay(keyId: key.id))
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(isSelected ? Color.accentColor.opacity(0.2) : Color.clear)
        .cornerRadius(6)
        .contentShape(Rectangle())
    }
}
