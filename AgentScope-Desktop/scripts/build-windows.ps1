param([string]$BackendDir = $env:AGENTSCOPE_BACKEND_DIR, [string]$BackendArtifact = "")
$ErrorActionPreference = "Stop"
$desktopRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $desktopRoot
. "$PSScriptRoot\initialize-msvc.ps1"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed" }
& "$PSScriptRoot\build-backend.ps1" -BackendDir $BackendDir -BackendArtifact $BackendArtifact
& npm.cmd run desktop:build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
Write-Host "Installer: src-tauri/target/release/bundle/nsis/"
