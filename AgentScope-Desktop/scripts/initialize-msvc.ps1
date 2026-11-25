# Activate installed build tools for this process only; no system settings are changed.
$ErrorActionPreference = "Stop"
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Microsoft C++ Build Tools and Windows SDK first.' }
    $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installation) { throw 'No installed MSVC compiler was found.' }
    $devCommand = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
    $toolEnvironment = & cmd.exe /d /c "call `"$devCommand`" -arch=x64 -host_arch=x64 >nul && set"
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the installed C++ build environment.' }
    foreach ($line in $toolEnvironment) {
        $separator = $line.IndexOf('=')
        if ($separator -gt 0) {
            $variableName = $line.Substring(0,$separator)
            if ($variableName -notin @('HOME','CODEX_HOME')) { Set-Item -Path "Env:$variableName" -Value $line.Substring($separator+1) }
        }
    }
}
