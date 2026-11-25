$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\initialize-msvc.ps1"
& npm.cmd run tauri -- dev
if ($LASTEXITCODE -ne 0) { throw 'Tauri development failed' }
