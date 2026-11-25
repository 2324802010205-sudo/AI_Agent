$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed" }
Write-Host "Desktop dependencies ready. Set up AgentScope-Backend separately before desktop:dev."
