#Requires -Version 5.1
# Starfleet Agent v5.6 - Production Build

# --- CONFIGURATION ---
$ApiBase     = "https://api.starfleet.icircles.rw"
$ApiToken    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiYWRtaW4AdGVzdC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzY2OTEwMjMsImV4cCI6MTgwODIyNzAyM30.lKvEgZlhZku-L6bOsEGqJjBnrhNrLcm5FR8BMbVI588"
$DataDir     = "C:\ProgramData\Starfleet"
$DeviceFile  = "$DataDir\device.json"
$QueueDir    = "$DataDir\queue"
$LogFile     = "$DataDir\agent.log"
$GrpcurlPath = "$DataDir\grpcurl.exe"

# Ensure TLS Compatibility
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

# --- UTILITIES ---
function Write-Log {
    param([string]$Level = "INFO", [string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "[$ts] [$Level] $Message"
    if (-not (Test-Path $DataDir)) { New-Item $DataDir -ItemType Directory -Force | Out-Null }
    Write-Host $line -ForegroundColor ($Level -eq "ERROR" ? "Red" : "Cyan")
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Get-Distance {
    param([double]$lat1, [double]$lon1, [double]$lat2, [double]$lon2)
    $r = 6371 # km
    $dLat = [Math]::PI / 180 * ($lat2 - $lat1); $dLon = [Math]::PI / 180 * ($lon2 - $lon1)
    $a = [Math]::Sin($dLat/2) * [Math]::Sin($dLat/2) + [Math]::Cos([Math]::PI / 180 * $lat1) * [Math]::Cos([Math]::PI / 180 * $lat2) * [Math]::Sin($dLon/2) * [Math]::Sin($dLon/2)
    return $r * (2 * [Math]::Atan2([Math]::Sqrt($a), [Math]::Sqrt(1-$a)))
}

# --- TELEMETRY ---
function Get-LocationData {
    $loc = @{ lat=$null; lon=$null }
    $cmd = if (Get-Command grpcurl -ErrorAction SilentlyContinue) { "grpcurl" } else { $GrpcurlPath }
    if (-not (Test-Path $cmd) -and $cmd -ne "grpcurl") { return $loc }
    try {
        # Using verified --% stop-parsing for raw JSON delivery
        $raw = & $cmd --% -plaintext -d "{\"get_location\":{}}" 192.168.100.1:9200 SpaceX.API.Device.Device/Handle | ConvertFrom-Json
        if ($raw.getLocation.lla.lat) {
            $loc.lat = [math]::Round($raw.getLocation.lla.lat, 6)
            $loc.lon = [math]::Round($raw.getLocation.lla.lon, 6)
        }
    } catch { Write-Log "WARN" "gRPC Location fetch failed." }
    return $loc
}

# --- MAIN EXECUTION ---
Write-Log "INFO" "Cycle Start"
foreach ($dir in @($DataDir, $QueueDir)) { if (-not (Test-Path $dir)) { New-Item $dir -ItemType Directory -Force | Out-Null } }

# 1. Load/Create Identity
$config = if (Test-Path $DeviceFile) { Get-Content $DeviceFile -Raw | ConvertFrom-Json } else { $null }
$deviceSN = if ($config) { $config.device_sn } else { (Get-CimInstance Win32_BIOS).SerialNumber.Trim() }
$siteId = if ($config) { $config.site_id } else { 0 }

# 2. Gather Dashboard Metrics
$os = (Get-CimInstance Win32_OperatingSystem).Caption
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$storagePct = [math]::Round((($disk.Size - $disk.FreeSpace) / $disk.Size) * 100, 0)
$battery = (Get-CimInstance Win32_Battery).EstimatedChargeRemaining
$loc = Get-LocationData

# 3. Handle Auto-Discovery (Site 0 Fix)
if ($siteId -eq 0 -and $loc.lat -and $loc.lon) {
    try {
        $headers = @{ Authorization = "Bearer $ApiToken"; "Accept" = "application/json" }
        $sites = Invoke-RestMethod -Uri "$ApiBase/api/sites" -Headers $headers -TimeoutSec 30
        $minDist = [double]::MaxValue; $foundId = 0
        foreach ($site in $sites) {
            if ($null -eq $site.lat -or $null -eq $site.lng -or $site.id -eq 0) { continue }
            $dist = Get-Distance -lat1 $loc.lat -lon1 $loc.lon -lat2 $site.lat -lon2 $site.lng
            if ($dist -lt $minDist) { $minDist = $dist; $foundId = $site.id }
        }
        if ($foundId -ne 0) {
            $siteId = $foundId
            @{ device_sn = $deviceSN; site_id = $siteId } | ConvertTo-Json | Set-Content $DeviceFile
            Write-Log "INFO" "Discovered Site ID: $siteId"
        }
    } catch { Write-Log "ERROR" "Discovery request failed." }
}

# 4. Prepare & Send Heartbeat
$body = @{
    device_sn      = $deviceSN
    site_id        = [int]$siteId
    timestamp_utc  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    hostname       = $env:COMPUTERNAME
    os             = $os
    model          = (Get-CimInstance Win32_ComputerSystem).Model
    manufacturer   = (Get-CimInstance Win32_ComputerSystem).Manufacturer
    battery_pct    = if ($null -eq $battery) { 100 } else { $battery }
    disk_usage_pct = $storagePct
}

try {
    $headers = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }
    Invoke-RestMethod -Uri "$ApiBase/ingest/heartbeat" -Method POST -Headers $headers -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 30 | Out-Null
    Write-Log "INFO" "Sync Success (Site $siteId)"
} catch {
    Write-Log "WARN" "Sync failed. Payload queued."
    $body | ConvertTo-Json -Compress | Set-Content "$QueueDir\$((Get-Date).Ticks).json"
}
Write-Log "INFO" "Cycle Complete"