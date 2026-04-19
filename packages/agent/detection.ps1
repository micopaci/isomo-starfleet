#Requires -Version 5.1
<#
.SYNOPSIS
    Intune Proactive Remediation — DETECTION script
.DESCRIPTION
    Returns exit code 0 if the Starfleet agent is healthy (last heartbeat < 10 min ago).
    Returns exit code 1 if the agent needs remediation (stale or missing heartbeat).
    Intune runs this script on a schedule; if it exits 1, remediation.ps1 is triggered.
#>

$HeartbeatFile  = "C:\ProgramData\Starfleet\last_heartbeat.txt"
$MaxAgeMinutes  = 10

try {
    if (-not (Test-Path $HeartbeatFile)) {
        Write-Host "DETECTION: Heartbeat file missing — needs remediation"
        exit 1
    }

    $lastHeartbeatStr = (Get-Content $HeartbeatFile -Raw).Trim()
    # Use ParseExact with ISO 8601 format to avoid culture-dependent parsing failures
    # on non-English Windows installations common in Rwanda
    $lastHeartbeat = [datetime]::ParseExact(
        $lastHeartbeatStr,
        'yyyy-MM-ddTHH:mm:ssZ',
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal
    )
    $ageMinutes       = (Get-Date).ToUniversalTime().Subtract($lastHeartbeat).TotalMinutes

    if ($ageMinutes -gt $MaxAgeMinutes) {
        Write-Host "DETECTION: Last heartbeat was $([math]::Round($ageMinutes,1)) min ago — needs remediation"
        exit 1
    }

    Write-Host "DETECTION: Agent healthy (last heartbeat $([math]::Round($ageMinutes,1)) min ago)"
    exit 0
}
catch {
    Write-Host "DETECTION: Error reading heartbeat file — $($_.Exception.Message)"
    exit 1
}
