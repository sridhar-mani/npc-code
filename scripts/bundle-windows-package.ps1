<#
.SYNOPSIS
    Bundles the Pi Coding Suite for Windows distribution.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

Write-Host "=== 1. Building Agent Dependencies & Bundle ===" -ForegroundColor Cyan
Write-Host "Building packages/chord..."
$chordDir = Join-Path $repoRoot "packages\chord"
& npm --prefix $chordDir run build
if ($LASTEXITCODE -ne 0) {
    throw "Failed to build packages/chord."
}

$terminalUiDir = Join-Path $repoRoot "packages\terminal-ui"
$bundleSource = Join-Path $terminalUiDir "dist\bundle"
if (-not (Test-Path (Join-Path $bundleSource "cli.js"))) {
    $existingLib = Join-Path $repoRoot "linux-package\lib"
    if (Test-Path (Join-Path $existingLib "cli.js")) {
        Write-Host "Using pre-built bundle from linux-package/lib..."
        $bundleSource = $existingLib
    } else {
        Write-Host "Building terminal-ui bundle..."
        & npm --prefix $terminalUiDir run build
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to build terminal-ui bundle."
        }
    }
}

Write-Host "=== 2. Building VS Code Extension VSIX ===" -ForegroundColor Cyan
$vscodeUiDir = Join-Path $repoRoot "packages\vscode-ui"
Set-Location $vscodeUiDir

$packageJson = Get-Content (Join-Path $vscodeUiDir "package.json") -Raw | ConvertFrom-Json
$extensionName = $packageJson.name
$extensionVersion = $packageJson.version
$vsixPath = Join-Path $vscodeUiDir "$extensionName-$extensionVersion.vsix"

# Clean previous vsix files
Get-ChildItem -Path $vscodeUiDir -Filter "*.vsix" | Remove-Item -Force

Write-Host "Building vscode-ui extension..."
& node .esbuild.ts --sourcemaps
if ($LASTEXITCODE -ne 0) {
    throw "Failed to compile vscode-ui extension."
}

Write-Host "Packaging VSIX with vsce..."
& npx --no-install @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation
if ($LASTEXITCODE -ne 0) {
    throw "Failed to package extension VSIX."
}

if (-not (Test-Path $vsixPath)) {
    throw "Expected VSIX output not found at: $vsixPath"
}

Set-Location $repoRoot

Write-Host "=== 3. Assembling Windows Package ===" -ForegroundColor Cyan
$packageDir = Join-Path $repoRoot "dist\windows-package"
if (Test-Path $packageDir) {
    Remove-Item -Path $packageDir -Recurse -Force
}

$libDir = Join-Path $packageDir "lib"
New-Item -ItemType Directory -Path $libDir -Force | Out-Null

# Copy terminal agent bundle
if (Test-Path $bundleSource) {
    Copy-Item -Path (Join-Path $bundleSource "*") -Destination $libDir -Recurse -Force
} else {
    throw "Terminal agent bundle missing at $bundleSource"
}

# Copy package.json for version/config resolution
Copy-Item -Path (Join-Path $terminalUiDir "package.json") -Destination (Join-Path $libDir "package.json") -Force

# Copy runtime dependencies required by standalone binary
$chordDest = Join-Path $libDir "node_modules\@earendil-works\chord"
New-Item -ItemType Directory -Path $chordDest -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot "packages\chord\*") -Destination $chordDest -Recurse -Force

$nmDest = Join-Path $libDir "node_modules"
$silviaSource = Join-Path $repoRoot "node_modules\@silvia-odwyer"
if (Test-Path $silviaSource) {
    Copy-Item -Path $silviaSource -Destination $nmDest -Recurse -Force
}
$jitiSource = Join-Path $repoRoot "node_modules\jiti"
if (Test-Path $jitiSource) {
    Copy-Item -Path $jitiSource -Destination $nmDest -Recurse -Force
}

# Copy VS Code extension VSIX
Copy-Item -Path $vsixPath -Destination (Join-Path $packageDir "your-agent.vsix") -Force
Copy-Item -Path $vsixPath -Destination (Join-Path $packageDir "pi-agent.vsix") -Force

# Copy installer scripts
$windowsPackageSrc = Join-Path $repoRoot "windows-package"
Copy-Item -Path (Join-Path $windowsPackageSrc "install.ps1") -Destination (Join-Path $packageDir "install.ps1") -Force
Copy-Item -Path (Join-Path $windowsPackageSrc "install.cmd") -Destination (Join-Path $packageDir "install.cmd") -Force

# Also update root windows-package folder with lib and vsix for immediate local use
$rootWinPkg = Join-Path $repoRoot "windows-package"
$rootWinLib = Join-Path $rootWinPkg "lib"
if (-not (Test-Path $rootWinLib)) {
    New-Item -ItemType Directory -Path $rootWinLib -Force | Out-Null
}
Copy-Item -Path (Join-Path $libDir "*") -Destination $rootWinLib -Recurse -Force
Copy-Item -Path $vsixPath -Destination (Join-Path $rootWinPkg "your-agent.vsix") -Force
Copy-Item -Path $vsixPath -Destination (Join-Path $rootWinPkg "pi-agent.vsix") -Force

Write-Host "=== 4. Creating Distribution Archive ===" -ForegroundColor Cyan
$distDir = Join-Path $repoRoot "dist"
$zipPath = Join-Path $distDir "pi-windows-bundle.zip"
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

Write-Host "Windows bundle assembled at: $packageDir" -ForegroundColor Green
Write-Host "ZIP archive created at:      $zipPath" -ForegroundColor Green
