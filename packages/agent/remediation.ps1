#Requires -Version 5.1
<#
.SYNOPSIS
    Intune Proactive Remediation — REMEDIATION script
.DESCRIPTION
    1. Creates C:\ProgramData\Starfleet\ directory
    2. Copies StarfleetAgent.ps1 from this package into that directory
    3. Injects $ApiToken and $SiteId from Intune script parameters
    4. Registers a Windows Scheduled Task that runs the agent every 5 minutes
    5. Runs the agent once immediately

.PARAMETER ApiToken
    JWT token for the Starfleet backend (set as Intune script parameter).
.PARAMETER SiteId
    Numeric site ID for this school (set as Intune script parameter per device group).
.PARAMETER ApiBase
    Base URL of the Starfleet backend. Defaults to production URL.
#>
param(
    [Parameter(Mandatory=$true)]  [string]$ApiToken,
    [Parameter(Mandatory=$true)]  [string]$SiteId,
    [Parameter(Mandatory=$false)] [string]$ApiBase = "https://starfleet.yourdomain.com"
)

$DataDir    = "C:\ProgramData\Starfleet"
$AgentDest  = "$DataDir\StarfleetAgent.ps1"
$AgentSrc   = Join-Path $PSScriptRoot "StarfleetAgent.ps1"
$TaskName   = "StarfleetAgent"

# ── 1. Ensure directory exists ────────────────────────────────────────────────
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# ── 2. Copy agent script ──────────────────────────────────────────────────────
if (-not (Test-Path $AgentSrc)) {
    Write-Host "REMEDIATION: ERROR — StarfleetAgent.ps1 not found at $AgentSrc"
    exit 1
}
Copy-Item -Path $AgentSrc -Destination $AgentDest -Force

# ── 3. Inject runtime configuration ──────────────────────────────────────────
$content = Get-Content $AgentDest -Raw

$content = $content -replace '(?m)^\$ApiBase\s*=\s*".*"',   "`$ApiBase     = `"$ApiBase`""
$content = $content -replace '(?m)^\$ApiToken\s*=\s*".*"',  "`$ApiToken    = `"$ApiToken`""
$content = $content -replace '(?m)^\$SiteId\s*=\s*".*"',    "`$SiteId      = `"$SiteId`""

Set-Content -Path $AgentDest -Value $content -Encoding UTF8

# ── 4. Register Scheduled Task ────────────────────────────────────────────────
$taskExists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($taskExists) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action  = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$AgentDest`""

# Trigger: start at boot + repeat every 5 minutes indefinitely
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.RepetitionInterval = (New-TimeSpan -Minutes 5)
$trigger.RepetitionDuration = [System.TimeSpan]::MaxValue

# Run as SYSTEM, works on AC and battery
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -StartWhenAvailable `
    -DisallowStartIfOnBatteries:$false `
    -StopIfGoingOnBatteries:$false `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $action `
    -Trigger   $trigger `
    -Principal $principal `
    -Settings  $settings `
    -Force | Out-Null

Write-Host "REMEDIATION: Scheduled task '$TaskName' registered (repeat every 5 min)"

# ── 5. Run agent once immediately ─────────────────────────────────────────────
Write-Host "REMEDIATION: Running agent immediately…"
Start-ScheduledTask -TaskName $TaskName

Write-Host "REMEDIATION: Complete"
exit 0
