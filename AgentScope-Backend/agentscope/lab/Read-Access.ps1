param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $request.observer_sid) { throw 'Wrong witness identity' }
$oldest = Get-WinEvent -LogName Security -Oldest -MaxEvents 1
$latest = Get-WinEvent -LogName Security -MaxEvents 1
$query = "*[System[(EventID=4656 or EventID=4663 or EventID=1102) and EventRecordID > $([long]$request.first_record_id)]]"
$auditReadErrors = @()
$events = @(Get-WinEvent -LogName Security -FilterXPath $query -ErrorAction SilentlyContinue -ErrorVariable +auditReadErrors)
foreach ($auditError in $auditReadErrors) { if ($auditError.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw 'Security witness query failed' } }
$result = @()
$cleared = $false
foreach ($event in $events) {
    if ($event.Id -eq 1102) { $cleared = $true; continue }
    [xml]$xml = $event.ToXml()
    $fields = @{}
    foreach ($entry in $xml.Event.EventData.Data) { $fields[$entry.Name] = [string]$entry.'#text' }
    if ($fields.SubjectUserSid -ne $request.actor_sid) { continue }
    $path = $fields.ObjectName
    if (-not $path -or -not $path.StartsWith($request.root + '\',[StringComparison]::OrdinalIgnoreCase)) { continue }
    $mask = if ($fields.AccessMask) { [Convert]::ToInt64($fields.AccessMask.Replace('0x',''),16) } else { 0 }
    $keywords = [Convert]::ToUInt64(([string]$xml.Event.System.Keywords).Replace('0x',''),16)
    $resource = $null
    foreach ($property in $request.resources.PSObject.Properties) {
        if ($path.Equals([string]$property.Value,[StringComparison]::OrdinalIgnoreCase)) { $resource = $property.Name }
    }
    $result += [ordered]@{ record_id=$event.RecordId; event_id=$event.Id; timestamp=$event.TimeCreated.ToUniversalTime().ToString('o');
        path=$path; resource_id=$resource; actor_sid=$fields.SubjectUserSid; process_id=$fields.ProcessId; process_name=$fields.ProcessName;
        access_mask=$mask; access_used=($event.Id -eq 4663 -and ($mask -band 0x10007) -ne 0);
        access_denied=($event.Id -eq 4656 -and ($keywords -band [uint64]0x0010000000000000) -ne 0) }
}
[ordered]@{ readable=$true; log_cleared=$cleared; oldest_record_id=$oldest.RecordId; latest_record_id=$latest.RecordId;
    continuous=($oldest.RecordId -le ([long]$request.first_record_id + 1) -and $latest.RecordId -ge [long]$request.first_record_id -and -not $cleared);
    events=@($result); resource_sddl=(Get-Acl -LiteralPath (Join-Path $request.root 'research') -Audit).Sddl } | ConvertTo-Json -Depth 7 -Compress
