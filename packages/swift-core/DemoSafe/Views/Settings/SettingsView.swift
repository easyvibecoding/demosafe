import SwiftUI

/// Main settings window with tabbed navigation.
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gear") }

            KeyManagementTab()
                .tabItem { Label("Keys", systemImage: "key") }

            ContextModeTab()
                .tabItem { Label("Contexts", systemImage: "theatermasks") }

            SecuritySettingsTab()
                .tabItem { Label("Security", systemImage: "lock.shield") }

            ShortcutsTab()
                .tabItem { Label("Shortcuts", systemImage: "keyboard") }

            AboutTab()
                .tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 560, height: 420)
    }
}

// MARK: - General

struct GeneralSettingsTab: View {
    @EnvironmentObject var appState: AppState
    @AppStorage("launchAtLogin") private var launchAtLogin = false

    var body: some View {
        Form {
            Section("Startup") {
                Toggle("Launch at login", isOn: $launchAtLogin)
            }

            Section("Status") {
                LabeledContent("Connected Extensions") {
                    Text("\(appState.connectedClients)")
                }
                LabeledContent("Pattern Cache Version") {
                    Text("\(appState.maskingCoordinator.patternCacheVersion)")
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Key Management

struct KeyManagementTab: View {
    @EnvironmentObject var appState: AppState
    @State private var showingAddSheet = false
    @State private var showingAddServiceSheet = false
    @State private var showingAddGroupSheet = false
    @State private var editingGroup: LinkedGroup?

    var body: some View {
        VStack {
            List {
                // Keys by service
                ForEach(appState.vaultManager.getAllServices()) { service in
                    Section(service.name) {
                        ForEach(appState.vaultManager.getKeys(serviceId: service.id)) { key in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(key.label)
                                    HStack(spacing: 4) {
                                        Text(appState.maskingCoordinator.maskedDisplay(keyId: key.id))
                                        if let groupId = key.linkedGroupId,
                                           let group = appState.vaultManager.getLinkedGroup(groupId: groupId) {
                                            Text("· \(group.label)")
                                                .foregroundColor(.accentColor)
                                        }
                                    }
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                }
                                Spacer()
                                Button(role: .destructive) {
                                    try? appState.vaultManager.deleteKey(keyId: key.id)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                }

                // Linked Groups
                if !appState.vaultManager.vault.linkedGroups.isEmpty {
                    Section("Linked Groups") {
                        ForEach(appState.vaultManager.vault.linkedGroups) { group in
                            HStack {
                                VStack(alignment: .leading) {
                                    HStack(spacing: 6) {
                                        Text(group.label)
                                        Text(group.pasteMode == .sequential ? "Sequential" : "Select Field")
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(group.pasteMode == .sequential ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
                                            .cornerRadius(4)
                                    }
                                    Text(group.entries.map(\.fieldLabel).joined(separator: " → "))
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Button {
                                    editingGroup = group
                                } label: {
                                    Image(systemName: "pencil")
                                }
                                .buttonStyle(.borderless)
                                Button(role: .destructive) {
                                    try? appState.vaultManager.deleteLinkedGroup(groupId: group.id)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            .listStyle(.inset)

            HStack {
                Button("Add Service...") {
                    showingAddServiceSheet = true
                }
                Button("Add Group...") {
                    showingAddGroupSheet = true
                }
                .disabled(appState.vaultManager.getAllKeys().count < 2)
                Spacer()
                Button("Add Key...") {
                    showingAddSheet = true
                }
            }
            .padding()
        }
        .sheet(isPresented: $showingAddSheet) {
            AddKeySheet()
        }
        .sheet(isPresented: $showingAddServiceSheet) {
            AddServiceSheet()
        }
        .sheet(isPresented: $showingAddGroupSheet) {
            AddGroupSheet()
        }
        .sheet(item: $editingGroup) { group in
            EditGroupSheet(group: group)
        }
    }
}

// MARK: - Add Key Sheet

struct AddKeySheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    @State private var label = ""
    @State private var value = ""
    @State private var selectedServiceId: UUID?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("Add API Key")
                .font(.headline)

            Form {
                Picker("Service", selection: $selectedServiceId) {
                    Text("Select...").tag(nil as UUID?)
                    ForEach(appState.vaultManager.getAllServices()) { service in
                        Text(service.name).tag(service.id as UUID?)
                    }
                }

                TextField("Label", text: $label)
                SecureField("API Key Value", text: $value)

                if let error = errorMessage {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Add") { addKey() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(label.isEmpty || value.isEmpty || selectedServiceId == nil)
            }
        }
        .padding()
        .frame(width: 400)
    }

    private func addKey() {
        guard let serviceId = selectedServiceId,
              let service = appState.vaultManager.getService(serviceId: serviceId) else {
            errorMessage = "Please select a service"
            return
        }

        do {
            let _ = try appState.vaultManager.addKey(
                label: label,
                serviceId: serviceId,
                pattern: service.defaultPattern,
                maskFormat: service.defaultMaskFormat,
                value: Data(value.utf8)
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Add Service Sheet

struct AddServiceSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var defaultPattern = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("Add Service")
                .font(.headline)

            Form {
                TextField("Service Name", text: $name)
                    .textFieldStyle(.roundedBorder)

                TextField("Default Key Pattern (regex)", text: $defaultPattern)
                    .textFieldStyle(.roundedBorder)

                Text("Example: sk-[a-zA-Z0-9]{48}")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if let error = errorMessage {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Add") { addService() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }

    private func addService() {
        do {
            let pattern = defaultPattern.isEmpty ? ".*" : defaultPattern
            let service = Service(
                id: UUID(),
                name: name,
                icon: nil,
                defaultPattern: pattern,
                defaultMaskFormat: .default,
                isBuiltIn: false
            )
            try appState.vaultManager.addService(service)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Add Group Sheet

struct AddGroupSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    @State private var label = ""
    @State private var pasteMode: PasteMode = .sequential
    @State private var selectedEntries: [GroupEntryDraft] = []
    @State private var errorMessage: String?

    struct GroupEntryDraft: Identifiable {
        let id = UUID()
        let keyId: UUID
        let keyLabel: String
        let serviceName: String
        var fieldLabel: String
    }

    /// All keys not already in a group.
    private var availableKeys: [(KeyEntry, String)] {
        let services = appState.vaultManager.getAllServices()
        var result: [(KeyEntry, String)] = []
        for service in services {
            for key in appState.vaultManager.getKeys(serviceId: service.id) {
                if key.linkedGroupId == nil {
                    result.append((key, service.name))
                }
            }
        }
        return result
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("Create Linked Group")
                .font(.headline)

            Form {
                TextField("Group Name", text: $label)
                    .textFieldStyle(.roundedBorder)

                Picker("Paste Mode", selection: $pasteMode) {
                    Text("Sequential (Tab between fields)").tag(PasteMode.sequential)
                    Text("Select Field (choose one)").tag(PasteMode.selectField)
                }

                Section("Select Keys (in order)") {
                    ForEach(availableKeys, id: \.0.id) { key, serviceName in
                        let isSelected = selectedEntries.contains(where: { $0.keyId == key.id })
                        Button {
                            if isSelected {
                                selectedEntries.removeAll { $0.keyId == key.id }
                            } else {
                                selectedEntries.append(GroupEntryDraft(
                                    keyId: key.id,
                                    keyLabel: key.label,
                                    serviceName: serviceName,
                                    fieldLabel: key.label
                                ))
                            }
                        } label: {
                            HStack {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(isSelected ? .accentColor : .secondary)
                                VStack(alignment: .leading) {
                                    Text(key.label)
                                    Text(serviceName)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if isSelected, let idx = selectedEntries.firstIndex(where: { $0.keyId == key.id }) {
                                    Text("#\(idx + 1)")
                                        .font(.caption)
                                        .foregroundColor(.accentColor)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !selectedEntries.isEmpty {
                    Section("Field Labels") {
                        ForEach($selectedEntries) { $entry in
                            HStack {
                                Text("#\(selectedEntries.firstIndex(where: { $0.id == entry.id }).map { $0 + 1 } ?? 0)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .frame(width: 24)
                                TextField("Field label", text: $entry.fieldLabel)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }
                    }
                }

                if let error = errorMessage {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Create") { createGroup() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(label.isEmpty || selectedEntries.count < 2)
            }
        }
        .padding()
        .frame(width: 450, height: 480)
    }

    private func createGroup() {
        let entries = selectedEntries.enumerated().map { idx, draft in
            GroupEntry(keyId: draft.keyId, fieldLabel: draft.fieldLabel, sortOrder: idx)
        }

        do {
            let _ = try appState.vaultManager.createLinkedGroup(
                label: label,
                entries: entries,
                pasteMode: pasteMode
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Edit Group Sheet

struct EditGroupSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    let group: LinkedGroup

    @State private var label: String
    @State private var pasteMode: PasteMode
    @State private var selectedEntries: [AddGroupSheet.GroupEntryDraft]
    @State private var errorMessage: String?

    init(group: LinkedGroup) {
        self.group = group
        _label = State(initialValue: group.label)
        _pasteMode = State(initialValue: group.pasteMode)
        _selectedEntries = State(initialValue: group.entries
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { AddGroupSheet.GroupEntryDraft(keyId: $0.keyId, keyLabel: "", serviceName: "", fieldLabel: $0.fieldLabel) }
        )
    }

    /// All keys: either not in any group, or already in this group.
    private var availableKeys: [(KeyEntry, String)] {
        let services = appState.vaultManager.getAllServices()
        var result: [(KeyEntry, String)] = []
        for service in services {
            for key in appState.vaultManager.getKeys(serviceId: service.id) {
                if key.linkedGroupId == nil || key.linkedGroupId == group.id {
                    result.append((key, service.name))
                }
            }
        }
        return result
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("Edit Linked Group")
                .font(.headline)

            Form {
                TextField("Group Name", text: $label)
                    .textFieldStyle(.roundedBorder)

                Picker("Paste Mode", selection: $pasteMode) {
                    Text("Sequential (Tab between fields)").tag(PasteMode.sequential)
                    Text("Select Field (choose one)").tag(PasteMode.selectField)
                }

                Section("Select Keys (in order)") {
                    ForEach(availableKeys, id: \.0.id) { key, serviceName in
                        let isSelected = selectedEntries.contains(where: { $0.keyId == key.id })
                        Button {
                            if isSelected {
                                selectedEntries.removeAll { $0.keyId == key.id }
                            } else {
                                selectedEntries.append(AddGroupSheet.GroupEntryDraft(
                                    keyId: key.id,
                                    keyLabel: key.label,
                                    serviceName: serviceName,
                                    fieldLabel: key.label
                                ))
                            }
                        } label: {
                            HStack {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(isSelected ? .accentColor : .secondary)
                                VStack(alignment: .leading) {
                                    Text(key.label)
                                    Text(serviceName)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if isSelected, let idx = selectedEntries.firstIndex(where: { $0.keyId == key.id }) {
                                    Text("#\(idx + 1)")
                                        .font(.caption)
                                        .foregroundColor(.accentColor)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !selectedEntries.isEmpty {
                    Section("Field Labels") {
                        ForEach($selectedEntries) { $entry in
                            HStack {
                                Text("#\(selectedEntries.firstIndex(where: { $0.id == entry.id }).map { $0 + 1 } ?? 0)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .frame(width: 24)
                                TextField("Field label", text: $entry.fieldLabel)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }
                    }
                }

                if let error = errorMessage {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Save") { saveGroup() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(label.isEmpty || selectedEntries.count < 2)
            }
        }
        .padding()
        .frame(width: 450, height: 480)
        .onAppear { populateKeyLabels() }
    }

    /// Fill in keyLabel/serviceName from vault (init only has keyId + fieldLabel).
    private func populateKeyLabels() {
        let services = appState.vaultManager.getAllServices()
        for i in selectedEntries.indices {
            if let key = appState.vaultManager.getKey(keyId: selectedEntries[i].keyId) {
                let svcName = services.first(where: { $0.id == key.serviceId })?.name ?? ""
                selectedEntries[i] = AddGroupSheet.GroupEntryDraft(
                    keyId: key.id,
                    keyLabel: key.label,
                    serviceName: svcName,
                    fieldLabel: selectedEntries[i].fieldLabel
                )
            }
        }
    }

    private func saveGroup() {
        let entries = selectedEntries.enumerated().map { idx, draft in
            GroupEntry(keyId: draft.keyId, fieldLabel: draft.fieldLabel, sortOrder: idx)
        }

        do {
            try appState.vaultManager.updateLinkedGroup(
                groupId: group.id,
                label: label,
                entries: entries,
                pasteMode: pasteMode
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Context Mode

struct ContextModeTab: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        List {
            ForEach(appState.vaultManager.getAllContextModes()) { ctx in
                HStack {
                    VStack(alignment: .leading) {
                        Text(ctx.name)
                            .fontWeight(ctx.isActive ? .bold : .regular)
                        HStack(spacing: 12) {
                            Text("Masking: \(ctx.maskingLevel.rawValue)")
                                .font(.caption)
                            if let seconds = ctx.clipboardClearSeconds {
                                Text("Auto-clear: \(seconds)s")
                                    .font(.caption)
                            }
                        }
                        .foregroundColor(.secondary)
                    }
                    Spacer()
                    if ctx.isActive {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.accentColor)
                    } else {
                        Button("Activate") {
                            appState.switchContext(contextId: ctx.id)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.inset)
    }
}

// MARK: - Security

struct SecuritySettingsTab: View {
    @AppStorage("requireTouchID") private var requireTouchID = false
    @AppStorage("systemWideMasking") private var systemWideMasking = false
    @EnvironmentObject var appState: AppState

    var body: some View {
        Form {
            Section("Demo Mode Enhancement") {
                Toggle("System-wide masking (experimental)", isOn: $systemWideMasking)
                    .onChange(of: systemWideMasking) { _, enabled in
                        if enabled && appState.isDemoMode {
                            appState.systemMaskingService.start()
                        } else {
                            appState.systemMaskingService.stop()
                        }
                    }
                Text("When Demo Mode is active, mask API keys detected in any application using Accessibility overlay.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Section("Keychain") {
                Toggle("Require Touch ID for key access", isOn: $requireTouchID)
                Text("When enabled, Touch ID or password is required each time a key is accessed from the Keychain.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Section("Security Info") {
                LabeledContent("Keychain Protection") {
                    Text("whenUnlockedThisDeviceOnly")
                        .font(.caption)
                }
                LabeledContent("IPC Binding") {
                    Text("127.0.0.1 only")
                        .font(.caption)
                }
                LabeledContent("ipc.json Permission") {
                    Text("chmod 600")
                        .font(.caption)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Shortcuts

struct ShortcutsTab: View {
    var body: some View {
        Form {
            Section("Registered Shortcuts") {
                LabeledContent("Toggle Toolbox") { Text("⌃⌥Space") }
                LabeledContent("Toggle Demo Mode") { Text("⌃⌥⌘D") }
                LabeledContent("Paste Key [1-9]") { Text("⌃⌥⌘[1-9]") }
                LabeledContent("Capture Clipboard") { Text("⌃⌥⌘V") }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - About

struct AboutTab: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "shield.checkered")
                .font(.system(size: 48))
                .foregroundColor(.accentColor)

            Text("DemoSafe")
                .font(.title)

            Text("API Key Manager for Live Demos")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Text("Version 0.1.0")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
