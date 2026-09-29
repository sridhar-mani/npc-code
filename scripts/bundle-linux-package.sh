#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== 1. Building Agent Dependencies & Bundle ==="
echo "Building packages/chord..."
npm --prefix "$REPO_ROOT/packages/chord" run build

TERMINAL_UI_DIR="$REPO_ROOT/packages/terminal-ui"
BUNDLE_SOURCE="$TERMINAL_UI_DIR/dist/bundle"

if [ ! -f "$BUNDLE_SOURCE/cli.js" ]; then
    if [ -f "$REPO_ROOT/linux-package/lib/cli.js" ]; then
        echo "Using pre-built bundle from linux-package/lib..."
        BUNDLE_SOURCE="$REPO_ROOT/linux-package/lib"
    else
        echo "Building terminal-ui bundle..."
        npm --prefix "$TERMINAL_UI_DIR" run build
    fi
fi

echo "=== 2. Building VS Code Extension VSIX ==="
echo "Building vscode-ui bundle and VSIX..."
cd "$REPO_ROOT/packages/vscode-ui"
EXTENSION_NAME="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).name")"
EXTENSION_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
VSIX_PATH="$REPO_ROOT/packages/vscode-ui/$EXTENSION_NAME-$EXTENSION_VERSION.vsix"
rm -f "$REPO_ROOT/packages/vscode-ui/"*.vsix
node .esbuild.ts --sourcemaps
npx --no-install @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation
cd "$REPO_ROOT"
test -f "$VSIX_PATH"

echo "=== 3. Assembling Linux Package ==="
PACKAGE_DIR="$REPO_ROOT/dist/linux-package"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/lib"
mkdir -p "$PACKAGE_DIR/bin"

# Copy terminal agent bundle
cp -r "$BUNDLE_SOURCE/"* "$PACKAGE_DIR/lib/"

# Copy package.json for version/config resolution
cp "$TERMINAL_UI_DIR/package.json" "$PACKAGE_DIR/lib/package.json"

# Copy runtime dependencies required by standalone binary
mkdir -p "$PACKAGE_DIR/lib/node_modules/@earendil-works"
cp -r "$REPO_ROOT/packages/chord" "$PACKAGE_DIR/lib/node_modules/@earendil-works/chord"
if [ -d "$REPO_ROOT/node_modules/@silvia-odwyer" ]; then
    cp -rL "$REPO_ROOT/node_modules/@silvia-odwyer" "$PACKAGE_DIR/lib/node_modules/"
fi
if [ -d "$REPO_ROOT/node_modules/jiti" ]; then
    cp -rL "$REPO_ROOT/node_modules/jiti" "$PACKAGE_DIR/lib/node_modules/"
fi

# Copy VS Code extension VSIX
cp "$VSIX_PATH" "$PACKAGE_DIR/your-agent.vsix"
cp "$VSIX_PATH" "$PACKAGE_DIR/pi-agent.vsix"

# Copy installer script from template
cp "$REPO_ROOT/linux-package/install.sh" "$PACKAGE_DIR/install.sh"
chmod +x "$PACKAGE_DIR/install.sh"

# Sync to root linux-package folder for immediate local repository use
ROOT_LINUX_PKG="$REPO_ROOT/linux-package"
mkdir -p "$ROOT_LINUX_PKG/lib"
cp -r "$PACKAGE_DIR/lib/"* "$ROOT_LINUX_PKG/lib/"
cp "$VSIX_PATH" "$ROOT_LINUX_PKG/your-agent.vsix"
cp "$VSIX_PATH" "$ROOT_LINUX_PKG/pi-agent.vsix"

echo "=== 4. Creating Distribution Archive ==="
ARCHIVE_PATH="$REPO_ROOT/dist/pi-linux-bundle.tar.gz"
mkdir -p "$REPO_ROOT/dist"
tar -czf "$ARCHIVE_PATH" -C "$REPO_ROOT/dist" linux-package

echo "Linux bundle assembled at: $PACKAGE_DIR"
echo "Tarball created at:        $ARCHIVE_PATH"
