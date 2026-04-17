#Requires -Version 5.1
<#
.SYNOPSIS
    Starlink Fleet Monitor — Windows Data Collection Agent
.DESCRIPTION
    Runs on every Isomo laptop every 5 minutes via Windows Scheduled Task.
    Collects Starlink dish metrics, device health, latency, and data usage,
    then POSTs to the Starfleet backend API.
    Queues payloads locally if the network is unavailable.
.NOTES
    Deployed via Intune Proactive Remediation.
    Values below are injected by the remediation script at deploy time.
#>

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION  (injected by Intune remediation script)
# ─────────────────────────────────────────────────────────────────────────────
$ApiBase     = "https://starfleet.yourdomain.com"
$ApiToken    = "JWT_PLACEHOLDER"
$SiteId      = "SITE_ID_PLACEHOLDER"
$IntervalSec = 300

# ─────────────────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────────────────
$DataDir       = "C:\ProgramData\Starfleet"
$DeviceFile    = "$DataDir\device.json"
$UsageBaseline = "$DataDir\usage_baseline.json"
$HeartbeatFile = "$DataDir\last_heartbeat.txt"
$QueueDir      = "$DataDir\queue"
$LogFile       = "$DataDir\agent.log"
$LogMaxBytes   = 5MB

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────
function Write-Log {
    param([string]$Level = "INFO", [string]$Message)
    $ts      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line    = "[$ts] [$Level] $Message"
    Write-Host $line

    # Rotate if log exceeds 5 MB
    if (Test-Path $LogFile) {
        if ((Get-Item $LogFile).Length -ge $LogMaxBytes) {
            $rotated = "$DataDir\agent.log.1"
            if (Test-Path $rotated) { Remove-Item $rotated -Force }
            Rename-Item $LogFile $rotated -Force
        }
    }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ─────────────────────────────────────────────────────────────────────────────
# INITIALISE DIRECTORIES
# ─────────────────────────────────────────────────────────────────────────────
foreach ($dir in @($DataDir, $QueueDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# HTTP HELPER
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-ApiPost {
    param([string]$Endpoint, [hashtable]$Body)

    $url     = "$ApiBase$Endpoint"
    $headers = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }
    $json    = $Body | ConvertTo-Json -Compress -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $url -Method POST -Headers $headers `
                        -Body $json -TimeoutSec 15 -ErrorAction Stop
        return $true
    }
    catch {
        Write-Log "WARN" "POST $Endpoint failed: $($_.Exception.Message). Queuing."
        Queue-Payload -Endpoint $Endpoint -Body $Body
        return $false
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# OFFLINE QUEUE
# ─────────────────────────────────────────────────────────────────────────────
function Queue-Payload {
    param([string]$Endpoint, [hashtable]$Body)

    # Cap at 1000 files — drop oldest if exceeded
    $files = Get-ChildItem $QueueDir -Filter "*.json" | Sort-Object Name
    if ($files.Count -ge 1000) {
        $files | Select-Object -First ($files.Count - 999) | Remove-Item -Force
    }

    $ts      = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
    $payload = @{ endpoint = $Endpoint; body = $Body } | ConvertTo-Json -Compress -Depth 5
    $payload | Set-Content -Path "$QueueDir\$ts.json" -Encoding UTF8
}

function Replay-Queue {
    $files = Get-ChildItem $QueueDir -Filter "*.json" | Sort-Object Name
    if ($files.Count -eq 0) { return }
    Write-Log "INFO" "Replaying $($files.Count) queued payload(s)…"

    foreach ($file in $files) {
        try {
            $item     = Get-Content $file.FullName -Raw | ConvertFrom-Json
            $endpoint = $item.endpoint
            $body     = @{}
            $item.body.PSObject.Properties | ForEach-Object { $body[$_.Name] = $_.Value }

            $url     = "$ApiBase$endpoint"
            $headers = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }
            $json    = $body | ConvertTo-Json -Compress -Depth 5

            Invoke-RestMethod -Uri $url -Method POST -Headers $headers `
                -Body $json -TimeoutSec 15 -ErrorAction Stop | Out-Null
            Remove-Item $file.FullName -Force
            Write-Log "INFO" "Replayed and deleted: $($file.Name)"
        }
        catch {
            Write-Log "WARN" "Replay failed for $($file.Name): $($_.Exception.Message)"
            break  # Stop replaying on first failure (still offline)
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# DEVICE REGISTRATION
# ─────────────────────────────────────────────────────────────────────────────
function Get-DeviceSN {
    try {
        return (Get-WmiObject Win32_BIOS).SerialNumber.Trim()
    }
    catch {
        Write-Log "ERROR" "Could not read BIOS serial: $($_.Exception.Message)"
        return $null
    }
}

function Register-Device {
    param([string]$DeviceSN)

    $hostname = $env:COMPUTERNAME
    $body     = @{
        device_sn     = $DeviceSN
        site_id       = [int]$SiteId
        hostname      = $hostname
        timestamp_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    Write-Log "INFO" "Registering device: $hostname ($DeviceSN) at site $SiteId"
    Invoke-ApiPost -Endpoint "/ingest/heartbeat" -Body $body | Out-Null

    # Persist device info locally
    @{ device_sn = $DeviceSN; hostname = $hostname; site_id = $SiteId } `
        | ConvertTo-Json | Set-Content -Path $DeviceFile -Encoding UTF8
}

# ─────────────────────────────────────────────────────────────────────────────
# STARLINK SIGNAL — gRPC fallback to HTTP status page
# ─────────────────────────────────────────────────────────────────────────────
function Get-StarlinkSignal {
    $dishIp = "192.168.100.1"

    # Try HTTP status page (JSON endpoint available without gRPC tooling)
    try {
        $status = Invoke-RestMethod -Uri "http://$dishIp/api/status" `
                      -TimeoutSec 5 -ErrorAction Stop

        $dish = $status.dishGetStatus
        if ($dish) {
            return @{
                pop_latency_ms  = [math]::Round($dish.popPingLatencyMs, 1)
                snr             = [math]::Round($dish.snr, 2)
                obstruction_pct = [math]::Round($dish.obstructionStats.fractionObstructed * 100, 2)
                ping_drop_pct   = [math]::Round($dish.popPingDropRate * 100, 2)
            }
        }
    }
    catch {
        Write-Log "WARN" "Starlink HTTP status unreachable: $($_.Exception.Message)"
    }

    # Try starlink_grpc Python tool if installed
    try {
        $grpcOut = & python -m starlink_grpc -t dish_status 2>$null | ConvertFrom-Json
        if ($grpcOut) {
            return @{
                pop_latency_ms  = [math]::Round($grpcOut.pop_ping_latency_ms, 1)
                snr             = [math]::Round($grpcOut.snr, 2)
                obstruction_pct = [math]::Round($grpcOut.obstruction_stats.fraction_obstructed * 100, 2)
                ping_drop_pct   = [math]::Round($grpcOut.pop_ping_drop_rate * 100, 2)
            }
        }
    }
    catch { }

    return $null  # Dish unreachable — do not send zeros
}

# ─────────────────────────────────────────────────────────────────────────────
# LATENCY — ping 8.8.8.8 x20, compute P50/P95
# ─────────────────────────────────────────────────────────────────────────────
function Get-LatencyStats {
    try {
        $pings = Test-Connection -ComputerName 8.8.8.8 -Count 20 -ErrorAction SilentlyContinue
        $times = $pings | Where-Object { $_.ResponseTime -ne $null } `
                        | ForEach-Object { $_.ResponseTime } `
                        | Sort-Object

        if ($times.Count -lt 5) {
            Write-Log "WARN" "Too few ping responses ($($times.Count)) for latency stats"
            return $null
        }

        $p50Index = [math]::Floor($times.Count * 0.50)
        $p95Index = [math]::Floor($times.Count * 0.95)

        return @{
            p50_ms = $times[$p50Index]
            p95_ms = $times[$p95Index]
        }
    }
    catch {
        Write-Log "WARN" "Latency measurement failed: $($_.Exception.Message)"
        return $null
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# HEALTH — battery, disk, RAM
# ─────────────────────────────────────────────────────────────────────────────
function Get-DeviceHealth {
    $health = @{}

    # Battery
    try {
        $bat = Get-WmiObject Win32_Battery
        if ($bat) {
            $health.battery_pct        = $bat.EstimatedChargeRemaining
            $health.battery_health_pct = if ($bat.DesignCapacity -gt 0) {
                [math]::Round($bat.FullChargeCapacity / $bat.DesignCapacity * 100, 1)
            } else { $null }
        }
    }
    catch { Write-Log "WARN" "Battery read failed: $($_.Exception.Message)" }

    # Disk C:\
    try {
        $disk = Get-PSDrive C
        $totalGB = [math]::Round(($disk.Used + $disk.Free) / 1GB, 1)
        $freeGB  = [math]::Round($disk.Free / 1GB, 1)
        $health.disk_total_gb = $totalGB
        $health.disk_free_gb  = $freeGB
    }
    catch { Write-Log "WARN" "Disk read failed: $($_.Exception.Message)" }

    # RAM
    try {
        $os = Get-WmiObject Win32_OperatingSystem
        $health.ram_total_mb = [math]::Round($os.TotalVisibleMemorySize / 1KB, 0)
        $health.ram_used_mb  = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1KB, 0)
    }
    catch { Write-Log "WARN" "RAM read failed: $($_.Exception.Message)" }

    return $health
}

# ─────────────────────────────────────────────────────────────────────────────
# DATA USAGE — delta from baseline
# ─────────────────────────────────────────────────────────────────────────────
function Get-DataUsageDelta {
    try {
        $adapters = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 0 }
        $totalDown = ($adapters | Measure-Object ReceivedBytes -Sum).Sum
        $totalUp   = ($adapters | Measure-Object SentBytes -Sum).Sum

        $baseline  = @{ down = 0; up = 0 }
        if (Test-Path $UsageBaseline) {
            $baseline = Get-Content $UsageBaseline -Raw | ConvertFrom-Json
            $baseline = @{ down = [long]$baseline.down; up = [long]$baseline.up }
        }

        $deltaDown = [math]::Max(0, $totalDown - $baseline.down)
        $deltaUp   = [math]::Max(0, $totalUp   - $baseline.up)

        # Update baseline
        @{ down = $totalDown; up = $totalUp } `
            | ConvertTo-Json | Set-Content -Path $UsageBaseline -Encoding UTF8

        return @{ bytes_down_delta = $deltaDown; bytes_up_delta = $deltaUp }
    }
    catch {
        Write-Log "WARN" "Data usage read failed: $($_.Exception.Message)"
        return $null
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
Write-Log "INFO" "StarfleetAgent starting (site=$SiteId)"

# Replay any queued offline payloads first
Replay-Queue

# Get or register device serial number
$deviceSN = $null
if (Test-Path $DeviceFile) {
    try {
        $cfg      = Get-Content $DeviceFile -Raw | ConvertFrom-Json
        $deviceSN = $cfg.device_sn
    }
    catch { }
}

if (-not $deviceSN) {
    $deviceSN = Get-DeviceSN
    if (-not $deviceSN) {
        Write-Log "ERROR" "Cannot determine device serial number. Exiting."
        exit 1
    }
    Register-Device -DeviceSN $deviceSN
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$today     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")

# Determine if this is a "6th interval" run (every 30 min)
# Track interval counter in a small file
$counterFile    = "$DataDir\interval_counter.txt"
$intervalCount  = 0
if (Test-Path $counterFile) {
    try { $intervalCount = [int](Get-Content $counterFile -Raw) } catch { }
}
$intervalCount++
$intervalCount | Set-Content -Path $counterFile -Encoding UTF8
$isHealthInterval = ($intervalCount % 6 -eq 0)

# ── a. HEARTBEAT ─────────────────────────────────────────────────────────────
$hbBody = @{
    device_sn     = $deviceSN
    site_id       = [int]$SiteId
    hostname      = $env:COMPUTERNAME
    timestamp_utc = $timestamp
}
if (Invoke-ApiPost -Endpoint "/ingest/heartbeat" -Body $hbBody) {
    $timestamp | Set-Content -Path $HeartbeatFile -Encoding UTF8
    Write-Log "INFO" "Heartbeat sent"
}

# ── b. STARLINK SIGNAL ───────────────────────────────────────────────────────
$signal = Get-StarlinkSignal
if ($signal) {
    $sigBody = @{
        device_sn      = $deviceSN
        site_id        = [int]$SiteId
        timestamp_utc  = $timestamp
        pop_latency_ms = $signal.pop_latency_ms
        snr            = $signal.snr
        obstruction_pct = $signal.obstruction_pct
        ping_drop_pct  = $signal.ping_drop_pct
    }
    if (Invoke-ApiPost -Endpoint "/ingest/signal" -Body $sigBody) {
        Write-Log "INFO" "Signal posted: SNR=$($signal.snr), PoP=$($signal.pop_latency_ms)ms"
    }
} else {
    Write-Log "WARN" "Starlink dish unreachable — skipping signal payload"
}

# ── c. LATENCY ───────────────────────────────────────────────────────────────
$latency = Get-LatencyStats
if ($latency) {
    $latBody = @{
        device_sn     = $deviceSN
        site_id       = [int]$SiteId
        timestamp_utc = $timestamp
        p50_ms        = $latency.p50_ms
        p95_ms        = $latency.p95_ms
    }
    if (Invoke-ApiPost -Endpoint "/ingest/latency" -Body $latBody) {
        Write-Log "INFO" "Latency posted: P50=$($latency.p50_ms)ms P95=$($latency.p95_ms)ms"
    }
}

# ── d. HEALTH (every 6th interval = 30 min) ──────────────────────────────────
if ($isHealthInterval) {
    $health = Get-DeviceHealth
    if ($health.Count -gt 0) {
        $healthBody = @{
            device_sn          = $deviceSN
            site_id            = [int]$SiteId
            timestamp_utc      = $timestamp
            battery_pct        = $health.battery_pct
            battery_health_pct = $health.battery_health_pct
            disk_free_gb       = $health.disk_free_gb
            disk_total_gb      = $health.disk_total_gb
            ram_used_mb        = $health.ram_used_mb
            ram_total_mb       = $health.ram_total_mb
        }
        if (Invoke-ApiPost -Endpoint "/ingest/health" -Body $healthBody) {
            Write-Log "INFO" "Health posted: Battery=$($health.battery_pct)% Disk=$($health.disk_free_gb)GB free"
        }
    }
}

# ── e. DATA USAGE (every 6th interval) ───────────────────────────────────────
if ($isHealthInterval) {
    $usage = Get-DataUsageDelta
    if ($usage) {
        $usageBody = @{
            device_sn        = $deviceSN
            site_id          = [int]$SiteId
            date             = $today
            bytes_down_delta = $usage.bytes_down_delta
            bytes_up_delta   = $usage.bytes_up_delta
        }
        if (Invoke-ApiPost -Endpoint "/ingest/usage" -Body $usageBody) {
            Write-Log "INFO" "Usage posted: Down=$([math]::Round($usage.bytes_down_delta/1MB,1))MB Up=$([math]::Round($usage.bytes_up_delta/1MB,1))MB"
        }
    }
}

Write-Log "INFO" "StarfleetAgent run complete"
