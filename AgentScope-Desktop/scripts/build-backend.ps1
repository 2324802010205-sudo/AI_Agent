param([string]$BackendDir = $env:AGENTSCOPE_BACKEND_DIR, [string]$BackendArtifact = "")
$ErrorActionPreference = "Stop"
$desktopRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
$targetTriple = (& rustc --print host-tuple).Trim()
if ($LASTEXITCODE -ne 0 -or $targetTriple -ne "x86_64-pc-windows-msvc") { throw "Windows x64 MSVC Rust toolchain required." }
if (-not $BackendArtifact) {
    if (-not $BackendDir) { $BackendDir = Join-Path (Split-Path -Parent $desktopRoot) 'AgentScope-Backend' }
    $BackendDir = (Resolve-Path -LiteralPath $BackendDir).Path
    $builder = Join-Path $BackendDir 'scripts\build-sidecar.ps1'
    if (-not (Test-Path -LiteralPath $builder)) { throw "Backend build script missing. Use -BackendDir or -BackendArtifact." }
    & $builder
    $BackendArtifact = Join-Path $BackendDir 'dist\agentscope-backend.exe'
}
$BackendArtifact = (Resolve-Path -LiteralPath $BackendArtifact).Path
$binaryDir = Join-Path $desktopRoot 'src-tauri\binaries'
New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null
Copy-Item -LiteralPath $BackendArtifact -Destination (Join-Path $binaryDir "agentscope-backend-$targetTriple.exe") -Force
Write-Host "Staged compiled backend artifact for $targetTriple (no backend source copied)."
