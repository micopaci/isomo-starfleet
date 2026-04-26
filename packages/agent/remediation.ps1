#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiToken,

    [int]$SiteId = 0,
    [string]$ApiBase = "https://api.starfleet.icircles.rw",
    [string]$InstallDir = "C:\ProgramData\Starfleet",
    [int]$IntervalMinutes = 5,
    [string]$PingHost = "1.1.1.1",
    [double]$MaxSiteRadiusKm = 2.0
)

$ErrorActionPreference = "Stop"

$TaskName = "StarfleetPulse"
$AgentSource = Join-Path $PSScriptRoot "StarfleetAgent.ps1"
$GrpcurlSource = Join-Path $PSScriptRoot "grpcurl.exe"
$AgentPath = Join-Path $InstallDir "StarfleetAgent.ps1"
$ConfigPath = Join-Path $InstallDir "agent.config.json"
$QueueDir = Join-Path $InstallDir "queue"

if ([string]::IsNullOrWhiteSpace($ApiToken)) {
    throw "ApiToken is required."
}
if ($SiteId -lt 0) {
    throw "SiteId must be 0 or a positive integer."
}
if (-not (Test-Path $AgentSource)) {
    throw "StarfleetAgent.ps1 must be packaged beside remediation.ps1."
}

foreach ($dir in @($InstallDir, $QueueDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -Path $dir -ItemType Directory -Force | Out-Null
    }
}

Copy-Item -Path $AgentSource -Destination $AgentPath -Force
if (Test-Path $GrpcurlSource) {
    Copy-Item -Path $GrpcurlSource -Destination (Join-Path $InstallDir "grpcurl.exe") -Force
}

$config = @{
    ApiBase = $ApiBase.TrimEnd("/")
    ApiToken = $ApiToken
    SiteId = $SiteId
    PingHost = $PingHost
    GrpcurlPath = (Join-Path $InstallDir "grpcurl.exe")
    MaxSiteRadiusKm = $MaxSiteRadiusKm
    QueueFlushLimit = 20
}
$config | ConvertTo-Json -Depth 8 | Set-Content -Path $ConfigPath -Encoding UTF8

try {
    icacls $InstallDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
} catch {
    Write-Warning "Unable to tighten ACLs on ${InstallDir}: $($_.Exception.Message)"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`" -DataDir `"$InstallDir`" -ConfigPath `"$ConfigPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Starfleet agent installed."
Write-Host "Task: $TaskName every $IntervalMinutes minutes"
Write-Host "Config: $ConfigPath"
