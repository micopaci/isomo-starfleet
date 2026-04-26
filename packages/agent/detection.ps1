#Requires -Version 5.1
$DataDir = "C:\ProgramData\Starfleet"
$AgentPath = Join-Path $DataDir "StarfleetAgent.ps1"
$ConfigPath = Join-Path $DataDir "agent.config.json"
$InstallSourcePath = Join-Path $DataDir "install_source.json"
$LastHeartbeatPath = Join-Path $DataDir "last_heartbeat.txt"
$TaskName = "StarfleetPulse"
$ExpectedAgentVersion = "1.2.0"

if (-not (Test-Path $AgentPath)) {
    Write-Host "Missing StarfleetAgent.ps1."
    exit 1
}

if (-not (Test-Path $ConfigPath)) {
    Write-Host "Missing agent.config.json."
    exit 1
}

try {
    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($config.ApiBase) -or [string]::IsNullOrWhiteSpace($config.ApiToken)) {
        Write-Host "Agent config is incomplete."
        exit 1
    }
} catch {
    Write-Host "Agent config is invalid JSON."
    exit 1
}

if (-not (Test-Path $InstallSourcePath)) {
    Write-Host "Missing Intune install marker."
    exit 1
}

try {
    $installSource = Get-Content -Path $InstallSourcePath -Raw | ConvertFrom-Json
    if ($installSource.source -ne "intune_remediation") {
        Write-Host "Agent was not installed by Intune remediation."
        exit 1
    }

    if ($installSource.agent_version -ne $ExpectedAgentVersion) {
        Write-Host "Agent version mismatch: expected $ExpectedAgentVersion, got $($installSource.agent_version)."
        exit 1
    }
} catch {
    Write-Host "Intune install marker is invalid JSON."
    exit 1
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Scheduled task $TaskName not found."
    exit 1
}

if (Test-Path $LastHeartbeatPath) {
    try {
        $lastHeartbeat = [datetime](Get-Content -Path $LastHeartbeatPath -Raw)
        if ($lastHeartbeat.ToUniversalTime() -lt (Get-Date).ToUniversalTime().AddMinutes(-30)) {
            Write-Host "Last successful heartbeat is older than 30 minutes."
            exit 1
        }
    } catch {
        Write-Host "Last heartbeat timestamp is invalid."
        exit 1
    }
}

Write-Host "Starfleet agent is installed and healthy from Intune remediation version $ExpectedAgentVersion."
exit 0
