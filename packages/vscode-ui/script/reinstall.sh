#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PKG_DIR"

echo "==> [1/4] Purging old caches and previous installations..."
code --uninstall-extension zenteiq.ziq-vscode-ui 2>/dev/null || true
rm -rf ~/.vscode/extensions/zenteiq.ziq-vscode-ui*
rm -rf ~/.config/Code/CachedExtensionVSIXs/*ziq*
rm -rf ~/.config/Code/User/globalStorage/zenteiq.ziq-vscode-ui*
rm -rf ~/.config/Code/User/workspaceStorage/*/zenteiq.ziq-vscode-ui*
rm -rf dist dist-sourcemaps *.vsix

echo "==> [2/4] Building production extension bundle..."
# Required runtime assets (WASM/tokenizers) are copied by the VS Code build postinstall.
# Keep the build self-contained: do not rely on a prior dist directory.
npm run build

VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="ziq-vscode-ui-${VERSION}.vsix"

echo "==> [3/4] Packaging ${VSIX_FILE}..."
npx --no-install @vscode/vsce package --allow-missing-repository --allow-star-activation -o "$VSIX_FILE"

echo "==> [4/4] Installing ${VSIX_FILE} into VS Code..."
code --install-extension "$VSIX_FILE" --force

echo ""
echo "==> Successfully rebuilt and installed zenteiq.ziq-vscode-ui v${VERSION}!"
echo "==> Run 'Developer: Reload Window' (Ctrl+Shift+P) in VS Code to load changes."
