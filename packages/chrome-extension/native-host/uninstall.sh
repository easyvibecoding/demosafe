#!/bin/bash
# Uninstall DemoSafe Native Messaging Host

set -e

HOST_NAME="com.demosafe.nmh"
NMH_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
INSTALL_DIR="$HOME/.demosafe/bin"

rm -f "$NMH_DIR/$HOST_NAME.json" && echo "Removed manifest"
rm -f "$INSTALL_DIR/demosafe-nmh" && echo "Removed binary"

echo "Uninstall complete."
