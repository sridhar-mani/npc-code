#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== 1. Building Terminal Coding Agent ==="
echo "Building terminal-ui bundle..."
npm --prefix "$REPO_ROOT/packages/terminal-ui" run build

echo "=== 2. Building VS Code Extension VSIX ==="
VSIX_PATH="$REPO_ROOT/packages/vscode-ui/ziq-vscode-ui-0.44.1.vsix"
rm -f "$VSIX_PATH"
echo "Building vscode-ui bundle and VSIX..."
cd "$REPO_ROOT/packages/vscode-ui"
node .esbuild.ts --dev
npx -y @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation
cd "$REPO_ROOT"

echo "=== 3. Assembling Linux Package ==="
PACKAGE_DIR="$REPO_ROOT/dist/linux-package"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/lib"
mkdir -p "$PACKAGE_DIR/bin"

# Copy terminal agent bundle
cp -r "$REPO_ROOT/packages/terminal-ui/dist/bundle/"* "$PACKAGE_DIR/lib/"

# Copy package.json for version/config resolution
cp "$REPO_ROOT/packages/terminal-ui/package.json" "$PACKAGE_DIR/lib/package.json"

# Copy runtime dependencies required by standalone binary
mkdir -p "$PACKAGE_DIR/lib/node_modules/@earendil-works"
cp -r "$REPO_ROOT/packages/chord" "$PACKAGE_DIR/lib/node_modules/@earendil-works/chord"
cp -rL "$REPO_ROOT/node_modules/@silvia-odwyer" "$PACKAGE_DIR/lib/node_modules/"
cp -rL "$REPO_ROOT/node_modules/jiti" "$PACKAGE_DIR/lib/node_modules/"

# Copy VS Code extension VSIX
cp "$VSIX_PATH" "$PACKAGE_DIR/your-agent.vsix"
cp "$VSIX_PATH" "$PACKAGE_DIR/pi-agent.vsix"

# Write installer script
cat << 'EOF' > "$PACKAGE_DIR/install.sh"
#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================="
echo "    Pi Coding Suite - Linux Installer"
echo "=================================================="

# 1. Determine install prefix
if [ "$(id -u)" -eq 0 ]; then
    INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local}"
else
    INSTALL_PREFIX="${INSTALL_PREFIX:-$HOME/.local}"
fi

BIN_DIR="$INSTALL_PREFIX/bin"
LIB_DIR="$INSTALL_PREFIX/lib/pi-agent"

echo "[1/4] Preparing directories..."
echo "  -> Target binary directory:  $BIN_DIR"
echo "  -> Target library directory: $LIB_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"

echo "[2/4] Installing Pi Terminal Coding Agent..."
echo "  -> Copying agent bundle files..."
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

# Global symlink if /usr/local/bin is writable
if [ -w /usr/local/bin ] && [ "$BIN_DIR" != "/usr/local/bin" ]; then
    ln -sf "$BIN_DIR/pi" /usr/local/bin/pi 2>/dev/null && echo "  -> Created global symlink: /usr/local/bin/pi" || true
fi

echo "  -> Terminal coding agent installed at: $BIN_DIR/pi"

# Check PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]] && ! command -v pi >/dev/null 2>&1; then
    echo "  [!] Notice: $BIN_DIR is not yet in your current shell's PATH."
    if [ -f "$HOME/.bashrc" ] && ! grep -q '\.local/bin' "$HOME/.bashrc"; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        echo "  [+] Automatically added '$HOME/.local/bin' to $HOME/.bashrc"
    fi
    echo "  [!] To use 'pi' immediately in this terminal, run:"
    echo "      export PATH=\"$BIN_DIR:\$PATH\""
else
    echo "  -> 'pi' command is available in PATH."
fi

# Test terminal agent version
if command -v node >/dev/null 2>&1; then
    AGENT_VERSION=$(node "$LIB_DIR/cli.js" --version 2>/dev/null || echo "installed")
    echo "  -> Pi agent verification: version $AGENT_VERSION"
fi

# Initialize ~/.pi/agent/models.json template if not present
PI_AGENT_DIR="$HOME/.pi/agent"
mkdir -p "$PI_AGENT_DIR"
if [ ! -f "$PI_AGENT_DIR/models.json" ]; then
    cat << 'MODEL_CONF' > "$PI_AGENT_DIR/models.json"
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "name": "Qwen 2.5 Coder 7B"
        }
      ]
    }
  }
}
MODEL_CONF
    echo "  -> Initialized default BYOM models template: $PI_AGENT_DIR/models.json"
fi

# 3. Check VS Code and install extension
echo "[3/4] Checking VS Code environment..."
if command -v code >/dev/null 2>&1; then
    echo "  -> VS Code detected: $(command -v code)"
    
    echo "  -> Removing existing GitHub Copilot and conflicting extensions..."
    for ext in GitHub.copilot GitHub.copilot-chat ms-vscode.vscode-websearchforcopilot clockzinc.pi-vscode-ui zenteiq.pi-vscode-ui; do
        if code --list-extensions | grep -iq "^${ext}$"; then
            echo "     Uninstalling conflicting extension: $ext..."
            code --uninstall-extension "$ext" 2>&1 || true
        fi
    done

    echo "  -> Installing latest Pi Coding Assistant extension (your-agent.vsix)..."
    code --install-extension ./your-agent.vsix --force

    echo "  -> Installed extensions matching 'pi-vscode-ui':"
    code --list-extensions | grep -i "pi-vscode-ui" || echo "     zenteiq.pi-vscode-ui installed."
else
    echo "  [!] VS Code CLI ('code') not found in PATH. Skipping VS Code extension installation."
    echo "      You can manually install the extension via: code --install-extension $SCRIPT_DIR/your-agent.vsix"
fi

echo "[4/4] Installation Complete!"
echo "=================================================="
echo "Next Steps:"
echo " 1. If 'pi' is not recognized in your current shell, reload your shell or run:"
echo "    export PATH=\"$BIN_DIR:\$PATH\""
echo " 2. In VS Code, reload the window to load the new extension:"
echo "    Ctrl+Shift+P -> 'Developer: Reload Window'"
echo "=================================================="
EOF

chmod +x "$PACKAGE_DIR/install.sh"

echo "=== 4. Creating Distribution Archive ==="
ARCHIVE_PATH="$REPO_ROOT/dist/pi-linux-bundle.tar.gz"
mkdir -p "$REPO_ROOT/dist"
tar -czf "$ARCHIVE_PATH" -C "$REPO_ROOT/dist" linux-package

echo "Linux bundle assembled at: $PACKAGE_DIR"
echo "Tarball created at: $ARCHIVE_PATH"
