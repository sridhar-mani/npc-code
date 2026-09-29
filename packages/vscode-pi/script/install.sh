#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Building packages/vscode-pi with esbuild..."
cd "${PKG_DIR}"
node esbuild.ts

echo "==> Packaging VSIX..."
echo y | npx --no-install vsce package --no-dependencies --allow-missing-repository -o dist/ziq-vscode-pi-0.1.0.vsix

echo "==> Removing legacy extension directory if installed..."
rm -rf "${HOME}/.vscode/extensions/zenteiq.ziq-vscode-ui-"* || true
rm -rf "${HOME}/.vscode/extensions/zenteiq.ziq-pi-vscode-"* || true

echo "==> Installing new extension into VS Code..."
code --install-extension dist/ziq-vscode-pi-0.1.0.vsix --force

echo "==> Successfully installed zenteiq.ziq-pi-vscode 0.1.0!"
