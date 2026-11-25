param(
    [Parameter(Mandatory)][guid]$VMId,
    [Parameter(Mandatory)][guid]$CheckpointId,
    [Parameter(Mandatory)][string]$RequestPath,
    [Parameter(Mandatory)][string]$GuestObserverCredentialPath,
    [Parameter(Mandatory)][string]$SigningKeyPath,
    [Parameter(Mandatory)][string]$OutputPath
)
# HOST ONLY. No guest credentials/settings are copied from the normal CLI profile.
# This verifies a dedicated VM; it does not create it or claim a checkpoint reset.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) { throw 'Hyper-V host management is unavailable' }
$vm = Get-VM -Id $VMId
if ($vm.Notes -ne 'AgentScopeSecurityLab' -or $vm.State -ne 'Running') { throw 'VM must be explicitly labelled disposable and running' }
$checkpoint = Get-VMSnapshot -VM $vm | Where-Object { $_.Id -eq $CheckpointId }
if (-not $checkpoint) { throw 'The selected disposable checkpoint does not exist' }
if ((Get-VMHost).EnableEnhancedSessionMode) { throw 'Enhanced-session host redirection must be disabled before attestation' }
if (@(Get-VMHardDiskDrive -VM $vm | Where-Object { $null -ne $_.DiskNumber }).Count) { throw 'Pass-through host disks are prohibited' }
if (@(Get-VMFibreChannelHba -VM $vm).Count) { throw 'Host storage adapters are prohibited' }
if (@(Get-VMDvdDrive -VM $vm | Where-Object { $_.Path }).Count) { throw 'Detach host ISO/DVD media before attestation' }
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($request.nonce -notmatch '^[0-9a-f]{64}$') { throw 'Invalid guest challenge' }
if ($request.lab_root -notmatch '^C:\\AgentScopeLab(?:\\[A-Za-z0-9._-]+)*$') { throw 'Invalid dedicated guest root' }
if (@($request.allowed_egress_addresses).Count -eq 0) { throw 'Model egress addresses must be explicitly reviewed' }
$credential = Import-Clixml -LiteralPath $GuestObserverCredentialPath
if ($credential -isnot [Management.Automation.PSCredential]) { throw 'Guest observer credential is not a protected PSCredential' }
$guest = Invoke-Command -VMId $VMId -Credential $credential -ArgumentList $request -ScriptBlock {
    param($declared)
    $ErrorActionPreference = 'Stop'
    $computer = Get-CimInstance Win32_ComputerSystem
    if ($computer.Manufacturer -ne 'Microsoft Corporation' -or $computer.Model -ne 'Virtual Machine') { throw 'Unexpected guest platform' }
    $observer = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($observer -ne $declared.observer_sid) { throw 'Wrong guest observer' }
    $actor = Get-LocalUser | Where-Object { $_.SID.Value -eq $declared.agent_sid }
    if (-not $actor -or -not $actor.Enabled) { throw 'Separate guest actor is unavailable' }
    if (@(Get-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-544') | Where-Object { $_.SID.Value -eq $declared.agent_sid }).Count) { throw 'Actor cannot be an administrator' }
    if (@(Get-SmbMapping).Count -or @(Get-SmbConnection).Count -or (Test-Path '\\tsclient\C')) { throw 'Guest host-share connection exists' }
    foreach ($profile in Get-NetFirewallProfile -PolicyStore ActiveStore) {
        if (-not $profile.Enabled -or $profile.DefaultOutboundAction -ne 'Block') { throw 'Guest outbound firewall must default deny' }
    }
    foreach ($rule in Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Outbound -Action Allow) {
        foreach ($address in @($rule | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)) {
            if ($address -notin $declared.allowed_egress_addresses -or $address -in @('Any','LocalSubnet')) { throw 'Unexpected guest egress address' }
        }
    }
    [ordered]@{ guest_uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID;
        runtime_python_sha256=(Get-FileHash -LiteralPath $declared.runtime_python -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$issued = [DateTimeOffset]::UtcNow
$document = [ordered]@{ nonce=$request.nonce; issued_at=$issued.ToString('o'); expires_at=$issued.AddMinutes(15).ToString('o');
    host_verified=$true; no_host_shares=$true; vm_id=$VMId.ToString(); snapshot_id=$CheckpointId.ToString();
    guest_uuid=$guest.guest_uuid; runtime_python_sha256=$guest.runtime_python_sha256 }
foreach ($field in @('lab_root','cli_profile_root','runtime_python','runtime_root','agent_sid','observer_sid','allowed_egress_addresses')) { $document[$field] = $request.$field }
$bytes = [Text.Encoding]::UTF8.GetBytes(($document | ConvertTo-Json -Depth 7 -Compress))
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
$rsa.FromXmlString((Get-Content -LiteralPath $SigningKeyPath -Raw))
if ($rsa.KeySize -lt 3072) { throw 'Use a dedicated host signing key of at least 3072 bits' }
[IO.File]::WriteAllBytes($OutputPath,$bytes)
[IO.File]::WriteAllText(($OutputPath + '.sig'),[Convert]::ToBase64String($rsa.SignData($bytes,'SHA256')))
Write-Output 'Attestation written. Copy only the public key, attestation and signature to the guest observer. Never copy the host private key.'
