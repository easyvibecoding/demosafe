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

    var body: some View {
        VStack {
            List {
                ForEach(appState.vaultManager.getAllServices()) { service in
                    Section(service.name) {
                        ForEach(appState.vaultManager.getKeys(serviceId: service.id)) { key in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(key.label)
                                    Text(appState.maskingCoordinator.maskedDisplay(keyId: key.id))
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
            }
            .listStyle(.inset)

            HStack {
                Button("Add Service...") {
                    showingAddServiceSheet = true
                }
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

    var body: some View {
        Form {
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
                LabeledContent("Paste Key [1-9]") { Text("⌃⌥[1-9]") }
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
