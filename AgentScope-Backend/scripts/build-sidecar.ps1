$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $backendRoot
try {
    $pythonExe = Join-Path $backendRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run backend scripts/setup.ps1 first.' }
    & $pythonExe -m pytest tests -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
    & $pythonExe -m PyInstaller --noconfirm --clean --distpath dist --workpath build agentscope-backend.spec
    if ($LASTEXITCODE -ne 0) { throw 'Frozen backend build failed' }
    Write-Host "Backend artifact: $backendRoot\dist\agentscope-backend.exe"
} finally { Pop-Location }
