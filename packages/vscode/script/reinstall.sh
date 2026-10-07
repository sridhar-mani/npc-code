#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"

cd "$PKG_DIR"

echo "==> [1/4] Purging old caches and previous installations..."
code --uninstall-extension npc.npc-vscode 2>/dev/null || true
code --uninstall-extension zenteiq.ziq-vscode-ui 2>/dev/null || true
code --uninstall-extension zenteiq.ziq-pi-vscode 2>/dev/null || true
rm -rf ~/.vscode/extensions/npc.npc-vscode*
rm -rf ~/.vscode/extensions/zenteiq.ziq-vscode-ui*
rm -rf ~/.vscode/extensions/zenteiq.ziq-pi-vscode*
rm -rf ~/.config/Code/CachedExtensionVSIXs/*npc*
rm -rf ~/.config/Code/CachedExtensionVSIXs/*ziq*
rm -rf ~/.config/Code/User/globalStorage/npc.npc-vscode*
rm -rf ~/.config/Code/User/globalStorage/zenteiq.ziq-vscode-ui*
rm -rf ~/.config/Code/User/globalStorage/zenteiq.ziq-pi-vscode*
rm -rf ~/.config/Code/User/workspaceStorage/*/npc.npc-vscode*
rm -rf ~/.config/Code/User/workspaceStorage/*/zenteiq.ziq-vscode-ui*
rm -rf ~/.config/Code/User/workspaceStorage/*/zenteiq.ziq-pi-vscode*
rm -rf dist *.vsix

echo "==> [2/4] Building clean NPC extension bundle (obfuscated & encrypted)..."
if [ -f "$REPO_ROOT/scripts/build-protected.mjs" ]; then
	node "$REPO_ROOT/scripts/build-protected.mjs" --vscode
else
	node .esbuild.ts
fi

VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="npc-vscode-${VERSION}.vsix"

echo "==> [3/4] Packaging ${VSIX_FILE}..."
npx --no-install @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation -o "$VSIX_FILE"

echo "==> [4/4] Installing ${VSIX_FILE} into VS Code..."
code --install-extension "$VSIX_FILE" --force

echo ""
echo "==> Successfully rebuilt and installed npc.npc-vscode v${VERSION}!"
echo "==> Run 'Developer: Reload Window' (Ctrl+Shift+P) in VS Code to load changes."

