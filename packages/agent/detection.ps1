#Requires -Version 5.1
$DataDir = "C:\ProgramData\Starfleet"
$AgentPath = Join-Path $DataDir "StarfleetAgent.ps1"
$ConfigPath = Join-Path $DataDir "agent.config.json"
$InstallSourcePath = Join-Path $DataDir "install_source.json"
$LastHeartbeatPath = Join-Path $DataDir "last_heartbeat.txt"
$TaskName = "StarfleetPulse"
$ExpectedAgentVersion = "1.2.0"

function ConvertFrom-Base64Url {
    param([string]$Value)

    $base64 = $Value.Replace("-", "+").Replace("_", "/")
    switch ($base64.Length % 4) {
        2 { $base64 += "==" }
        3 { $base64 += "=" }
        1 { throw "Invalid base64url length." }
    }

    return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))
}

function Read-JwtPayload {
    param([string]$Token)

    $parts = $Token.Split(".")
    if ($parts.Count -ne 3) {
        throw "Token is not a JWT with three parts."
    }

    return ConvertFrom-Base64Url -Value $parts[1] | ConvertFrom-Json
}

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

try {
    $tokenPayload = Read-JwtPayload -Token $config.ApiToken
    if ($tokenPayload.role -ne "agent") {
        Write-Host "Configured token role is '$($tokenPayload.role)', expected 'agent'."
        exit 1
    }

    if ($null -eq $tokenPayload.site_id) {
        Write-Host "Configured agent token is missing site_id."
        exit 1
    }

    if ($null -ne $installSource.site_id -and [int]$installSource.site_id -gt 0 -and [int]$tokenPayload.site_id -ne [int]$installSource.site_id) {
        Write-Host "Configured token site_id $($tokenPayload.site_id) does not match install marker site_id $($installSource.site_id)."
        exit 1
    }

    if ($null -ne $tokenPayload.exp) {
        $expiresAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$tokenPayload.exp).UtcDateTime
        if ($expiresAt -le (Get-Date).ToUniversalTime()) {
            Write-Host "Configured agent token expired at $($expiresAt.ToString("yyyy-MM-ddTHH:mm:ssZ"))."
            exit 1
        }
    }
} catch {
    Write-Host "Configured ApiToken is not a readable site-scoped JWT: $($_.Exception.Message)"
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
