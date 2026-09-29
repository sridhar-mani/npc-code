#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Installing Pi Terminal Coding Agent ==="

# Determine install prefix: /usr/local if root, or ~/.local if non-root
if [ "$(id -u)" -eq 0 ]; then
    INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local}"
else
    INSTALL_PREFIX="${INSTALL_PREFIX:-$HOME/.local}"
fi

BIN_DIR="$INSTALL_PREFIX/bin"
LIB_DIR="$INSTALL_PREFIX/lib/pi-agent"

mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"

echo "Installing terminal agent files to $LIB_DIR..."
cp -r "$SCRIPT_DIR/lib/"* "$LIB_DIR/"

# Create launcher executable
cat << 'LAUNCHER' > "$BIN_DIR/pi"
#!/usr/bin/env bash
PI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib/pi-agent" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js (>= 22) is required to run pi." >&2
    exit 1
fi

exec node "$PI_LIB_DIR/cli.js" "$@"
LAUNCHER

chmod +x "$BIN_DIR/pi"
chmod +x "$LIB_DIR/cli.js" 2>/dev/null || true

echo "Terminal coding agent installed: $BIN_DIR/pi"

# Check code command and install extension
if command -v code >/dev/null 2>&1; then
    echo "VS Code detected ('command -v code')."
    echo "Uninstalling any previous Pi / Copilot extension versions..."
    code --uninstall-extension clockzinc.pi-vscode-ui 2>/dev/null || true
    code --uninstall-extension zenteiq.pi-vscode-ui 2>/dev/null || true
    echo "Installing latest Pi Coding Assistant extension..."
    code --install-extension ./your-agent.vsix --force
else
    echo "VS Code ('code') not found in PATH. Skipping VS Code extension installation."
fi

echo "Done."
