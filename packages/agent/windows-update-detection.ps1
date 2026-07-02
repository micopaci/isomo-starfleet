#Requires -Version 5.1
# Starfleet remediation package "Starfleet - Windows Update" — DETECTION script.
# Runs as 64-bit SYSTEM via Intune proactive remediation.
# Exit 0 = compliant (no applicable software updates pending, or WU unavailable).
# Exit 1 = remediation required (pending software updates found).

$ErrorActionPreference = "Stop"
$AgentName = "windows-update-detect"

function Write-StarfleetLog {
    param(
        [string]$Level,
        [string]$Event,
        [hashtable]$Payload = @{}
    )
    $line = @{
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        level     = $Level
        agent     = $AgentName
        event     = $Event
        payload   = $Payload
    } | ConvertTo-Json -Compress -Depth 4
    Write-Host $line
}

try {
    $session  = New-Object -ComObject "Microsoft.Update.Session"
    $searcher = $session.CreateUpdateSearcher()
    $result   = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
} catch {
    # If the Windows Update COM API is unavailable the remediation script can't
    # work either — report compliant and surface the error in the log instead of
    # queuing a remediation that is guaranteed to fail.
    Write-StarfleetLog -Level "ERROR" -Event "wu_com_unavailable" -Payload @{ error = $_.Exception.Message }
    exit 0
}

$pendingCount = $result.Updates.Count
if ($pendingCount -eq 0) {
    Write-StarfleetLog -Level "INFO" -Event "no_pending_updates" -Payload @{}
    exit 0
}

$kbList = @()
$securityCount = 0
for ($i = 0; $i -lt $pendingCount; $i++) {
    $update = $result.Updates.Item($i)
    $kbIds = @()
    foreach ($kb in $update.KBArticleIDs) { $kbIds += "KB$kb" }
    $severity = [string]$update.MsrcSeverity
    if ($severity -eq "Critical" -or $severity -eq "Important") { $securityCount++ }
    $kbList += @{
        kb       = ($kbIds -join ",")
        title    = [string]$update.Title
        severity = $severity
    }
}

Write-StarfleetLog -Level "WARN" -Event "pending_updates" -Payload @{
    count          = $pendingCount
    security_count = $securityCount
    updates        = $kbList
}
exit 1
