param([string]$Python = "")
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not $Python) {
    foreach ($version in @('Python313','Python312','Python311','Python310')) {
        $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\$version\python.exe"
        if (Test-Path -LiteralPath $candidate) { $Python = $candidate; break }
    }
    if (-not $Python) { $Python = 'python' }
}
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & $Python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ required. Use -Python with its executable path.' }
}
& .\.venv\Scripts\python.exe -m pip install -e '.[dev]'
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency setup failed' }
Write-Host 'Backend ready: .\.venv\Scripts\python.exe -m agentscope --data-dir .agentscope --port 8765'
