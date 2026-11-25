param([Parameter(Mandatory)][string]$LaunchPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$launch = Get-Content -LiteralPath $LaunchPath -Raw -Encoding UTF8 | ConvertFrom-Json
$verified = & "$PSScriptRoot\Verify-Guest.ps1" -ConfigPath $launch.config_path -ChallengePath $launch.challenge_path | ConvertFrom-Json
if (-not $verified.verified) { throw 'Guest verification failed' }
$credential = Import-Clixml -LiteralPath $launch.credential_path
if ($credential -isnot [Management.Automation.PSCredential]) { throw 'Invalid actor identity credential' }
$networkIdentity = $credential.GetNetworkCredential()
$startInfo = New-Object Diagnostics.ProcessStartInfo
$startInfo.FileName = $launch.executable
$startInfo.Arguments = $launch.arguments
$startInfo.WorkingDirectory = $launch.cwd
$startInfo.UserName = $networkIdentity.UserName
$startInfo.Domain = if ($networkIdentity.Domain) { $networkIdentity.Domain } else { $env:COMPUTERNAME }
$startInfo.Password = $credential.Password
$startInfo.UseShellExecute = $false
$startInfo.LoadUserProfile = $true
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$config = Get-Content -LiteralPath $launch.config_path -Raw -Encoding UTF8 | ConvertFrom-Json
$actorProfile = (Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $config.agent_sid }).LocalPath
if (-not $actorProfile -or $actorProfile -eq $env:USERPROFILE) { throw 'A separate actor profile is required' }
# Do not pass the observer's backend token, cloud keys or developer environment.
$startInfo.EnvironmentVariables.Clear()
foreach ($entry in @{
    SystemRoot=$env:SystemRoot; WINDIR=$env:SystemRoot; COMSPEC=(Join-Path $env:SystemRoot 'System32\cmd.exe');
    PATH=((Split-Path -Parent $config.runtime_python) + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot);
    USERPROFILE=$actorProfile; LOCALAPPDATA=(Join-Path $actorProfile 'AppData\Local'); APPDATA=(Join-Path $actorProfile 'AppData\Roaming');
    TEMP=(Join-Path $actorProfile 'AppData\Local\Temp'); TMP=(Join-Path $actorProfile 'AppData\Local\Temp');
    USERNAME=$networkIdentity.UserName; USERDOMAIN=$env:COMPUTERNAME
}.GetEnumerator()) { $startInfo.EnvironmentVariables[$entry.Key] = $entry.Value }
$actor = New-Object Diagnostics.Process
$actor.StartInfo = $startInfo
try {
    if (-not $actor.Start()) { throw 'Actor process did not start' }
    [ordered]@{ actor_pid=$actor.Id; observer_pid=$PID; started_at=[DateTimeOffset]::UtcNow.ToString('o') } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $launch.pid_path -Encoding UTF8
    $outputCopy = $actor.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    # Drain diagnostics without returning private reasoning/credentials to clients.
    $errorCopy = $actor.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $inputCopy = [Console]::OpenStandardInput().CopyToAsync($actor.StandardInput.BaseStream)
    $actor.WaitForExit()
    $outputCopy.GetAwaiter().GetResult()
    $errorCopy.GetAwaiter().GetResult()
    exit $actor.ExitCode
} finally {
    if ($actor -and -not $actor.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $actor.Id /T /F >$null 2>&1 }
    $actor.Dispose()
}
