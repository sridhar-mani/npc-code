<#
.SYNOPSIS
    Rebuilds and reinstalls the NPC VS Code extension on Windows.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgDir = (Resolve-Path (Join-Path $scriptDir "..")).Path
Set-Location $pkgDir

Write-Host "==> [1/4] Purging old caches and previous installations..." -ForegroundColor Yellow
try { & code --uninstall-extension npc.npc-vscode 2>$null } catch {}

$userProfile = $env:USERPROFILE
Remove-Item -Path "$userProfile\.vscode\extensions\npc.npc-vscode*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:APPDATA\Code\CachedExtensionVSIXs\*npc*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:APPDATA\Code\User\globalStorage\npc.npc-vscode*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $pkgDir "dist") -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $pkgDir -Filter "*.vsix" | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "==> [2/4] Building clean NPC extension bundle..." -ForegroundColor Yellow
& node .esbuild.ts
if ($LASTEXITCODE -ne 0) { throw "esbuild failed." }

$packageJson = Get-Content (Join-Path $pkgDir "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$vsixFile = "$($packageJson.name)-$version.vsix"

Write-Host "==> [3/4] Packaging $vsixFile..." -ForegroundColor Yellow
& npx --no-install @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation -o "$vsixFile"
if ($LASTEXITCODE -ne 0) { throw "vsce package failed." }

Write-Host "==> [4/4] Installing $vsixFile into VS Code..." -ForegroundColor Yellow
& code --install-extension "$vsixFile" --force

Write-Host ""
Write-Host "==> Successfully rebuilt and installed $($packageJson.name) v$version!" -ForegroundColor Green
Write-Host "==> Run 'Developer: Reload Window' (Ctrl+Shift+P) in VS Code to load changes."
