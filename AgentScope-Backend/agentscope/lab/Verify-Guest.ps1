param([Parameter(Mandatory)][string]$ConfigPath, [Parameter(Mandatory)][string]$ChallengePath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Require-Lab([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$challenge = Get-Content -LiteralPath $ChallengePath -Raw -Encoding UTF8 | ConvertFrom-Json
$machine = Get-CimInstance Win32_ComputerSystem
Require-Lab ($machine.Manufacturer -eq 'Microsoft Corporation' -and $machine.Model -eq 'Virtual Machine') 'Not the supported Hyper-V guest'
$guestUuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
Require-Lab ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Observer must be elevated inside the dedicated guest'
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
$rsa.FromXmlString((Get-Content -LiteralPath $config.public_key_path -Raw))
Require-Lab ($rsa.KeySize -ge 3072) 'Pinned host key is too small'
$payloadBytes = [IO.File]::ReadAllBytes($config.attestation_path)
$signature = [Convert]::FromBase64String((Get-Content -LiteralPath ($config.attestation_path + '.sig') -Raw))
Require-Lab ($rsa.VerifyData($payloadBytes, 'SHA256', $signature)) 'Invalid host signature'
$attestation = [Text.Encoding]::UTF8.GetString($payloadBytes) | ConvertFrom-Json
$nowUtc = [DateTimeOffset]::UtcNow
Require-Lab ($attestation.nonce -eq $challenge.nonce) 'Challenge mismatch'
Require-Lab ([DateTimeOffset]::Parse($attestation.issued_at) -le $nowUtc.AddSeconds(30)) 'Future attestation'
Require-Lab ([DateTimeOffset]::Parse($attestation.expires_at) -gt $nowUtc.AddMinutes(3)) 'Attestation expired or too close to expiry'
Require-Lab (([DateTimeOffset]::Parse($attestation.expires_at) - [DateTimeOffset]::Parse($attestation.issued_at)).TotalMinutes -le 15) 'Attestation lifetime too long'
Require-Lab ($attestation.guest_uuid -eq $guestUuid) 'Wrong guest UUID'
Require-Lab ($attestation.observer_sid -eq $identity.User.Value -and $config.observer_sid -eq $identity.User.Value) 'Wrong observer identity'
Require-Lab ($attestation.agent_sid -eq $config.agent_sid -and $config.agent_sid -ne $identity.User.Value) 'Identity separation missing'
Require-Lab ($attestation.snapshot_id -match '^[0-9a-fA-F-]{36}$' -and $attestation.vm_id -match '^[0-9a-fA-F-]{36}$') 'No checkpoint identity'
Require-Lab ($attestation.host_verified -eq $true -and $attestation.no_host_shares -eq $true) 'Host checks missing'
Require-Lab ($config.lab_root -match '^C:\\AgentScopeLab(?:\\[A-Za-z0-9._-]+)*$') 'Lab root must be dedicated'
foreach ($field in @('lab_root','cli_profile_root','runtime_python','runtime_root','agent_sid','observer_sid')) {
    Require-Lab ($config.$field -eq $attestation.$field) ('Attested setting mismatch: ' + $field)
}
$agent = Get-LocalUser | Where-Object { $_.SID.Value -eq $config.agent_sid }
Require-Lab ($null -ne $agent -and $agent.Enabled) 'Agent local account unavailable'
$adminGroup = Get-LocalGroup -SID 'S-1-5-32-544'
$admins = @(Get-LocalGroupMember -Group $adminGroup -ErrorAction Stop | ForEach-Object { $_.SID.Value })
Require-Lab ($config.agent_sid -notin $admins) 'Agent is an administrator'
# Fail conservatively if the account belongs to any local group except Users.
foreach ($group in Get-LocalGroup) {
    $members = @(Get-LocalGroupMember -Group $group -ErrorAction Stop | ForEach-Object { $_.SID.Value })
    if ($config.agent_sid -in $members) { Require-Lab ($group.SID.Value -eq 'S-1-5-32-545') 'Agent has unexpected group membership' }
}
Require-Lab ((Test-Path -LiteralPath $config.runtime_python) -and (Test-Path -LiteralPath $config.agy_path) -and (Test-Path -LiteralPath $config.agent_credential_path)) 'Guest runtime or separate identity credential missing'
Require-Lab ($config.runtime_root.StartsWith($config.lab_root + '\',[StringComparison]::OrdinalIgnoreCase) -and $config.runtime_python.StartsWith($config.runtime_root + '\',[StringComparison]::OrdinalIgnoreCase)) 'Runtime must be in the dedicated observer-controlled tree'
$actorPrincipals = @($config.agent_sid,'S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-4','S-1-2-0','S-1-2-1','S-1-5-113')
$writeRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
function Assert-ObserverOwned([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    Require-Lab (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'Guarded path is a link/junction'
    $acl = Get-Acl -LiteralPath $Path
    $owner = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
    Require-Lab ($owner -ne $config.agent_sid) 'Actor owns a guarded path'
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $sid -in $actorPrincipals) {
            Require-Lab (($rule.FileSystemRights -band $writeRights) -eq 0) 'Actor can modify observer code/configuration'
        }
    }
}
foreach ($guarded in @($ConfigPath,$ChallengePath,$config.public_key_path,$config.attestation_path,$config.attestation_path + '.sig',$config.agent_credential_path,$config.runtime_root,$PSScriptRoot)) { Assert-ObserverOwned $guarded }
foreach ($file in Get-ChildItem -LiteralPath $config.runtime_root,$PSScriptRoot -Recurse -Force) { Assert-ObserverOwned $file.FullName }
Require-Lab ($config.cli_profile_root.StartsWith($config.lab_root + '\', [StringComparison]::OrdinalIgnoreCase)) 'CLI profile is not independent'
$settingsPath = Join-Path $config.cli_profile_root 'antigravity-cli\settings.json'
$cliSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$trust = @($cliSettings.trustedWorkspaces)
Require-Lab ($trust.Count -eq 1 -and $trust[0] -eq (Join-Path $config.lab_root 'trials')) 'CLI trust must be narrow and guest-specific'
Require-Lab (@(Get-SmbMapping -ErrorAction Stop).Count -eq 0) 'SMB mappings exist'
Require-Lab (@(Get-SmbConnection -ErrorAction Stop).Count -eq 0) 'SMB connections exist'
Require-Lab (@(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -like '\\*' }).Count -eq 0) 'Mapped host path exists'
Require-Lab (-not (Test-Path '\\tsclient\C')) 'RDP host drive exists'
foreach ($profile in Get-NetFirewallProfile -PolicyStore ActiveStore) {
    Require-Lab ($profile.Enabled -eq $true -and $profile.DefaultOutboundAction -eq 'Block') 'Outbound firewall is not default deny'
}
$allowed = @($attestation.allowed_egress_addresses)
Require-Lab ($allowed.Count -gt 0 -and 'Any' -notin $allowed -and 'LocalSubnet' -notin $allowed) 'No bounded model egress policy'
foreach ($rule in Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Outbound -Action Allow) {
    $addresses = @($rule | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)
    foreach ($address in $addresses) { Require-Lab ($address -in $allowed) 'Unexpected outbound allow address' }
    $ports = $rule | Get-NetFirewallPortFilter
    Require-Lab ($ports.Protocol -in @('TCP','UDP',6,17) -and @($ports.RemotePort | Where-Object { $_ -notin @('443','53') }).Count -eq 0) 'Unexpected outbound protocol/port'
}
# Security access must be observable independently of ACP and the actor account.
$latest = Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction Stop
$runtimeHash = (Get-FileHash -LiteralPath $config.runtime_python -Algorithm SHA256).Hash.ToLowerInvariant()
Require-Lab ($runtimeHash -eq $attestation.runtime_python_sha256) 'Runtime fingerprint changed'
[ordered]@{ verified=$true; guest_uuid=$guestUuid; observer_sid=$identity.User.Value; agent_sid=$config.agent_sid;
    expires_at=$attestation.expires_at; snapshot_id=$attestation.snapshot_id; vm_id=$attestation.vm_id;
    security_record_id=$latest.RecordId; os_sandbox='dedicated_vm_and_resource_acls';
    limitation='Per-trial NTFS/audit probes are still required; Job Objects are lifecycle controls only.' } | ConvertTo-Json -Depth 5 -Compress
