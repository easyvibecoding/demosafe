# Settings Page

The settings page opens as a **standalone macOS window** (not in the Menu Bar dropdown panel). It handles all low-frequency configuration operations.

## Settings Sections

| Section | Content |
|---------|---------|
| **Key Library** | Add / Edit / Delete / Group Keys; Import and Export; Search and Filter; Linked group management |
| **Shortcuts** | Customize all keyboard shortcuts; Conflict detection; Shortcut number assignment for each Key |
| **Context Modes** | Create / Edit / Delete context presets; Masking level and clipboard strategy per mode |
| **Masking Format** | Per-service masking format settings; Prefix length; Suffix visibility; Custom styles |
| **Extension Connection** | Connection status for VS Code Extension and Chrome Extension; Installation links; Sync status |
| **Security** | Clipboard auto-clear timer; Master password / biometric lock; Accessibility permission status |

## Smart Key Extraction

### Extraction Flow

1. **Scan**: Scan page content / clipboard content for known Key patterns
2. **Identify**: Identify the service provider based on Key prefix and page URL
3. **Confirm**: Display an extraction confirmation dialog with auto-classification
4. **Save**: After user confirmation, save the Key to the encrypted local vault

### Confirmation Dialog

```
3 Keys detected:
  ✓ OpenAI API Key   sk-proj-****  → Add to OpenAI group?
  ✓ AWS Access Key ID AKIA****     → Add to AWS / Production?
  ✓ AWS Secret Key    ****         ↔ Link with above?

  [ Add All ]  [ Confirm One by One ]  [ Cancel ]
```

### Linked Key Group Features

| Feature | Description |
|---------|-------------|
| Sequential paste | One shortcut fills in two fields in order (e.g., Access Key ID → Secret Key) |
| Batch export | Export the Key group as a complete `.env` block |
| Dependency tracking | When a Key is rotated, prompt the user to update linked Keys |
