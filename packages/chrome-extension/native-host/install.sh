#!/bin/bash
# Install DemoSafe Native Messaging Host for Chrome Extension
# Usage: ./install.sh [EXTENSION_ID]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_NAME="demosafe-nmh"
HOST_NAME="com.demosafe.nmh"
NMH_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Extension ID — pass as argument or use default
EXTENSION_ID="${1:-cockodmaleagghfbaookajpcpnbdjocj}"

echo "=== DemoSafe Native Messaging Host Installer ==="
echo "Extension ID: $EXTENSION_ID"

# Step 1: Compile if binary doesn't exist
if [ ! -f "$SCRIPT_DIR/$BINARY_NAME" ]; then
    echo "Compiling $BINARY_NAME..."
    swiftc "$SCRIPT_DIR/NativeMessagingHost.swift" -o "$SCRIPT_DIR/$BINARY_NAME" -O
fi

# Step 2: Install binary
INSTALL_DIR="$HOME/.demosafe/bin"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
chmod 755 "$INSTALL_DIR/$BINARY_NAME"
echo "Binary installed: $INSTALL_DIR/$BINARY_NAME"

# Step 3: Generate and install manifest
mkdir -p "$NMH_DIR"
cat > "$NMH_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "DemoSafe Native Messaging Host — reads ipc.json for Chrome Extension",
  "path": "$INSTALL_DIR/$BINARY_NAME",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
echo "Manifest installed: $NMH_DIR/$HOST_NAME.json"

echo ""
echo "=== Installation complete ==="
echo "Restart Chrome for changes to take effect."
echo ""
echo "To uninstall: ./uninstall.sh"
