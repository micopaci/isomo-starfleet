#Requires -Version 5.1
# Starfleet remediation package "Starfleet - Update Chrome" — REMEDIATION script.
# Runs as 64-bit SYSTEM via Intune proactive remediation.
# Forces Google Chrome to the latest stable release:
#   1. Kick Google Update (GoogleUpdate.exe /ua, or the modern updater --wake)
#      and poll the installed version for up to ~5 minutes.
#   2. If the updater is missing/blocked, silently install the latest enterprise
#      MSI (msiexec /qn /norestart).
# Never kills a running chrome.exe — an in-use update applies on relaunch and is
# reported as success (pending_relaunch).
# Exit 0 = success (updated, already current, or update staged). Nonzero = failed.

$ErrorActionPreference = "Stop"
$AgentName = "chrome-update-remediate"

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

function Get-InstalledChromeVersion {
    $path = Get-ChromePath
    if (-not $path) { return $null }
    return [version](Get-Item -Path $path).VersionInfo.ProductVersion
}

function Get-LatestStableChromeVersion {
    try {
        $response = Invoke-RestMethod -Uri "https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions?pageSize=1" -TimeoutSec 30
        if ($null -ne $response.versions -and $response.versions.Count -gt 0) {
            return [version][string]$response.versions[0].version
        }
    } catch { }
    return $null
}

function Get-StagedChromeVersion {
    param([version]$InstalledVersion)
    $path = Get-ChromePath
    if (-not $path) { return $null }
    try {
        $appDir = Split-Path -Path $path -Parent
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

# Log (but never modify) Google Update policies that can block updates.
try {
    $policy = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Google\Update" -ErrorAction SilentlyContinue
    if ($null -ne $policy) {
        $blockers = @{}
        foreach ($name in @("UpdateDefault", "AutoUpdateCheckPeriodMinutes", "DisableAutoUpdateChecksCheckboxValue")) {
            if ($null -ne $policy.$name) { $blockers[$name] = $policy.$name }
        }
        if ($blockers.Count -gt 0) {
            Write-StarfleetLog -Level "WARN" -Event "update_policy_present" -Payload $blockers
        }
    }
} catch { }

$before = Get-InstalledChromeVersion
if ($null -eq $before) {
    Write-StarfleetLog -Level "INFO" -Event "chrome_not_installed" -Payload @{}
    exit 0
}
$latest = Get-LatestStableChromeVersion
Write-StarfleetLog -Level "INFO" -Event "start" -Payload @{ installed = $before.ToString(); latest = "$latest" }

if ($null -ne $latest -and $before -ge $latest) {
    Write-StarfleetLog -Level "INFO" -Event "already_current" -Payload @{ installed = $before.ToString() }
    exit 0
}

# ── Step 1: kick Google Update ────────────────────────────────────────────────
$updaterRan = $false
$legacyUpdaters = @()
if (${env:ProgramFiles(x86)}) {
    $legacyUpdaters += (Join-Path ${env:ProgramFiles(x86)} "Google\Update\GoogleUpdate.exe")
}
$legacyUpdaters += (Join-Path $env:ProgramFiles "Google\Update\GoogleUpdate.exe")

foreach ($updater in $legacyUpdaters) {
    if (Test-Path -Path $updater) {
        try {
            $proc = Start-Process -FilePath $updater -ArgumentList "/ua", "/installsource", "scheduler" -Wait -PassThru -WindowStyle Hidden
            Write-StarfleetLog -Level "INFO" -Event "google_update_invoked" -Payload @{ path = $updater; exit_code = $proc.ExitCode }
            $updaterRan = $true
            break
        } catch {
            Write-StarfleetLog -Level "WARN" -Event "google_update_failed" -Payload @{ path = $updater; error = $_.Exception.Message }
        }
    }
}

if (-not $updaterRan) {
    $modernUpdaters = @((Join-Path $env:ProgramFiles "Google\GoogleUpdater"))
    if (${env:ProgramFiles(x86)}) {
        $modernUpdaters += (Join-Path ${env:ProgramFiles(x86)} "Google\GoogleUpdater")
    }
    foreach ($dir in $modernUpdaters) {
        if (Test-Path -Path $dir) {
            $exe = Get-ChildItem -Path $dir -Filter "updater.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -ne $exe) {
                try {
                    Start-Process -FilePath $exe.FullName -ArgumentList "--wake" -WindowStyle Hidden
                    Write-StarfleetLog -Level "INFO" -Event "modern_updater_woken" -Payload @{ path = $exe.FullName }
                    $updaterRan = $true
                    break
                } catch {
                    Write-StarfleetLog -Level "WARN" -Event "modern_updater_failed" -Payload @{ path = $exe.FullName; error = $_.Exception.Message }
                }
            }
        }
    }
}

if ($updaterRan) {
    # Poll for up to 5 minutes for the version to move (or a staged update to land).
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        $now = Get-InstalledChromeVersion
        if ($null -ne $now -and $now -gt $before -and ($null -eq $latest -or $now -ge $latest)) {
            Write-StarfleetLog -Level "INFO" -Event "updated" -Payload @{ from = $before.ToString(); to = $now.ToString() }
            exit 0
        }
        $staged = Get-StagedChromeVersion -InstalledVersion $before
        if ($staged) {
            Write-StarfleetLog -Level "INFO" -Event "pending_relaunch" -Payload @{ installed = $before.ToString(); staged = $staged }
            exit 0
        }
    }
    Write-StarfleetLog -Level "WARN" -Event "updater_timeout" -Payload @{ installed = (Get-InstalledChromeVersion).ToString() }
}

# ── Step 2: fallback — silent enterprise MSI install ─────────────────────────
$msiPath = Join-Path $env:TEMP "googlechromestandaloneenterprise64.msi"
try {
    Invoke-WebRequest -Uri "https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi" -OutFile $msiPath -UseBasicParsing -TimeoutSec 600
} catch {
    Write-StarfleetLog -Level "ERROR" -Event "msi_download_failed" -Payload @{ error = $_.Exception.Message }
    exit 1
}

$msi = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "`"$msiPath`"", "/qn", "/norestart" -Wait -PassThru
Remove-Item -Path $msiPath -Force -ErrorAction SilentlyContinue

$after = Get-InstalledChromeVersion
$staged = $null
if ($null -ne $after) { $staged = Get-StagedChromeVersion -InstalledVersion $after }

# 3010 = ERROR_SUCCESS_REBOOT_REQUIRED; with Chrome running the MSI stages the
# update to apply on relaunch — treat as success, never kill the browser.
if ($msi.ExitCode -eq 0 -or $msi.ExitCode -eq 3010 -or ($null -ne $after -and $after -gt $before) -or $staged) {
    Write-StarfleetLog -Level "INFO" -Event "msi_installed" -Payload @{ from = $before.ToString(); to = "$after"; staged = "$staged"; msi_exit = $msi.ExitCode }
    exit 0
}

Write-StarfleetLog -Level "ERROR" -Event "msi_install_failed" -Payload @{ msi_exit = $msi.ExitCode; installed = "$after" }
exit $msi.ExitCode
