#Requires -Version 5.1
# Starfleet remediation package "Starfleet - Update Chrome" — DETECTION script.
# Runs as 64-bit SYSTEM via Intune proactive remediation.
# Exit 0 = compliant (Chrome current, not installed, or newer version staged).
# Exit 1 = remediation required (Chrome outdated or updater stale).

$ErrorActionPreference = "Stop"
$AgentName = "chrome-update-detect"

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
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    Write-StarfleetLog -Level "WARN" -Event "tls_config_failed" -Payload @{ error = $_.Exception.Message }
}

function Get-ChromePath {
    $candidates = @()
    try {
        $appPath = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
        if ($null -ne $appPath -and $appPath.'(default)') { $candidates += $appPath.'(default)' }
    } catch { }
    $candidates += (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -Path $candidate)) { return $candidate }
    }
    return $null
}

function Get-LatestStableChromeVersion {
    try {
        $response = Invoke-RestMethod -Uri "https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions?pageSize=1" -TimeoutSec 30
        if ($null -ne $response.versions -and $response.versions.Count -gt 0) {
            return [string]$response.versions[0].version
        }
    } catch {
        Write-StarfleetLog -Level "WARN" -Event "version_api_unreachable" -Payload @{ error = $_.Exception.Message }
    }
    return $null
}

# A version folder newer than the running binary means the update is already
# downloaded and applies on next relaunch — compliant, do not force anything.
function Get-StagedChromeVersion {
    param([string]$ChromePath, [version]$InstalledVersion)
    try {
        $appDir = Split-Path -Path $ChromePath -Parent
        $folders = Get-ChildItem -Path $appDir -Directory -ErrorAction SilentlyContinue
        foreach ($folder in $folders) {
            $parsed = $null
            if ([version]::TryParse($folder.Name, [ref]$parsed)) {
                if ($parsed -gt $InstalledVersion) { return $folder.Name }
            }
        }
    } catch { }
    return $null
}

$chromePath = Get-ChromePath
if (-not $chromePath) {
    Write-StarfleetLog -Level "INFO" -Event "chrome_not_installed" -Payload @{}
    exit 0
}

$installedRaw = (Get-Item -Path $chromePath).VersionInfo.ProductVersion
$installed = [version]$installedRaw

$latestRaw = Get-LatestStableChromeVersion
if ($null -eq $latestRaw) {
    # Version API unreachable — fall back to Google Update freshness. LastChecked
    # is a Unix timestamp (seconds). A check older than 7 days means the updater
    # is not doing its job, so remediate.
    $lastChecked = $null
    foreach ($regPath in @("HKLM:\SOFTWARE\Wow6432Node\Google\Update", "HKLM:\SOFTWARE\Google\Update")) {
        try {
            $props = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
            if ($null -ne $props -and $null -ne $props.LastChecked) { $lastChecked = [int64]$props.LastChecked; break }
        } catch { }
    }
    if ($null -eq $lastChecked) {
        Write-StarfleetLog -Level "WARN" -Event "updater_freshness_unknown" -Payload @{ installed = $installedRaw }
        exit 1
    }
    $checkedAt = [DateTimeOffset]::FromUnixTimeSeconds($lastChecked).UtcDateTime
    $ageDays = ((Get-Date).ToUniversalTime() - $checkedAt).TotalDays
    if ($ageDays -gt 7) {
        Write-StarfleetLog -Level "WARN" -Event "updater_stale" -Payload @{ installed = $installedRaw; last_checked_days_ago = [math]::Round($ageDays, 1) }
        exit 1
    }
    Write-StarfleetLog -Level "INFO" -Event "updater_fresh" -Payload @{ installed = $installedRaw; last_checked_days_ago = [math]::Round($ageDays, 1) }
    exit 0
}

$latest = [version]$latestRaw
if ($installed -ge $latest) {
    Write-StarfleetLog -Level "INFO" -Event "chrome_current" -Payload @{ installed = $installedRaw; latest = $latestRaw }
    exit 0
}

$staged = Get-StagedChromeVersion -ChromePath $chromePath -InstalledVersion $installed
if ($staged) {
    Write-StarfleetLog -Level "INFO" -Event "staged_update" -Payload @{ installed = $installedRaw; staged = $staged; latest = $latestRaw }
    exit 0
}

Write-StarfleetLog -Level "WARN" -Event "chrome_outdated" -Payload @{ installed = $installedRaw; latest = $latestRaw }
exit 1
