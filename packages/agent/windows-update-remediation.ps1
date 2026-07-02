#Requires -Version 5.1
# Starfleet remediation package "Starfleet - Windows Update" — REMEDIATION script.
# Runs as 64-bit SYSTEM via Intune proactive remediation.
# Downloads and installs pending software updates via the Windows Update COM API,
# security-severity first, with a soft ~20-minute install window (no new install
# starts after the deadline; the next run continues).
# NEVER forces a reboot — RebootRequired is logged and left to a human (these are
# school devices). Falls back to UsoClient (best-effort) if COM is unavailable.
# Exit 0 = success (installs succeeded, possibly pending reboot). Nonzero = failed.

$ErrorActionPreference = "Stop"
$AgentName = "windows-update-remediate"
$InstallWindowMinutes = 20

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

function Get-UpdateKbLabel {
    param($Update)
    $kbIds = @()
    foreach ($kb in $Update.KBArticleIDs) { $kbIds += "KB$kb" }
    if ($kbIds.Count -gt 0) { return ($kbIds -join ",") }
    return [string]$Update.Title
}

function Get-SeverityRank {
    param($Update)
    switch ([string]$Update.MsrcSeverity) {
        "Critical"  { return 4 }
        "Important" { return 3 }
        "Moderate"  { return 2 }
        "Low"       { return 1 }
        default     { return 0 }
    }
}

try {
    $session  = New-Object -ComObject "Microsoft.Update.Session"
    $searcher = $session.CreateUpdateSearcher()
    $result   = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
} catch {
    Write-StarfleetLog -Level "ERROR" -Event "wu_com_unavailable" -Payload @{ error = $_.Exception.Message }
    # Best-effort fallback: nudge the Update Session Orchestrator. Fire-and-forget;
    # there is no reliable success signal from UsoClient.
    $uso = Join-Path $env:SystemRoot "System32\UsoClient.exe"
    if (Test-Path -Path $uso) {
        foreach ($verb in @("StartScan", "StartDownload", "StartInstall")) {
            try {
                Start-Process -FilePath $uso -ArgumentList $verb -WindowStyle Hidden
                Start-Sleep -Seconds 5
            } catch { }
        }
        Write-StarfleetLog -Level "WARN" -Event "usoclient_fallback_invoked" -Payload @{}
        exit 0
    }
    exit 1
}

if ($result.Updates.Count -eq 0) {
    Write-StarfleetLog -Level "INFO" -Event "no_pending_updates" -Payload @{}
    exit 0
}

# Order security-critical first, then by severity.
$ordered = @()
for ($i = 0; $i -lt $result.Updates.Count; $i++) { $ordered += $result.Updates.Item($i) }
$ordered = $ordered | Sort-Object -Property @{ Expression = { Get-SeverityRank -Update $_ }; Descending = $true }

Write-StarfleetLog -Level "INFO" -Event "start" -Payload @{ pending = $ordered.Count; window_min = $InstallWindowMinutes }

$deadline = (Get-Date).AddMinutes($InstallWindowMinutes)
$results = @()
$failed = 0
$installedCount = 0
$rebootRequired = $false
$deferred = 0

foreach ($update in $ordered) {
    if ((Get-Date) -gt $deadline) {
        $deferred++
        continue
    }
    $label = Get-UpdateKbLabel -Update $update

    try {
        if (-not $update.EulaAccepted) { $update.AcceptEula() | Out-Null }

        $coll = New-Object -ComObject "Microsoft.Update.UpdateColl"
        $coll.Add($update) | Out-Null

        if (-not $update.IsDownloaded) {
            $downloader = $session.CreateUpdateDownloader()
            $downloader.Updates = $coll
            $downloadResult = $downloader.Download()
            if ($downloadResult.ResultCode -ne 2) {
                $failed++
                $results += @{ kb = $label; phase = "download"; result_code = $downloadResult.ResultCode }
                continue
            }
        }

        $installer = $session.CreateUpdateInstaller()
        $installer.Updates = $coll
        $installer.ForceQuiet = $true
        $installResult = $installer.Install()

        # ResultCode: 2 = Succeeded, 3 = SucceededWithErrors, 4 = Failed, 5 = Aborted.
        if ($installResult.ResultCode -eq 2 -or $installResult.ResultCode -eq 3) {
            $installedCount++
        } else {
            $failed++
        }
        if ($installResult.RebootRequired) { $rebootRequired = $true }
        $results += @{ kb = $label; phase = "install"; result_code = $installResult.ResultCode; reboot_required = [bool]$installResult.RebootRequired }
    } catch {
        $failed++
        $results += @{ kb = $label; phase = "exception"; error = $_.Exception.Message }
    }
}

Write-StarfleetLog -Level $(if ($failed -gt 0) { "WARN" } else { "INFO" }) -Event "install_complete" -Payload @{
    installed       = $installedCount
    failed          = $failed
    deferred        = $deferred
    reboot_required = $rebootRequired
    results         = $results
}

if ($rebootRequired) {
    # Deliberately NOT rebooting — school devices; a human decides when.
    Write-StarfleetLog -Level "WARN" -Event "reboot_required" -Payload @{ note = "reboot deferred to operator" }
}

if ($installedCount -gt 0 -or $failed -eq 0) { exit 0 }
exit 1
