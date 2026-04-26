#Requires -Version 5.1
param(
    [string]$ConfigPath = "C:\ProgramData\Starfleet\agent.config.json",
    [string]$DataDir = "C:\ProgramData\Starfleet"
)

$ErrorActionPreference = "Stop"

function Find-StarlinkUtIdInBytes {
    param([byte[]]$Bytes)

    if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
        return $null
    }

    try {
        $text = [System.Text.Encoding]::ASCII.GetString($Bytes)
        $match = [regex]::Match($text, '(?i)ut[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}')
        if ($match.Success) {
            return $match.Value.ToLowerInvariant()
        }
    } catch {}

    return $null
}

function Normalize-StarlinkId {
    param([object]$Value)

    $id = ([string]$Value).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($id)) {
        return $null
    }

    if ($id -match '^ut([0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8})$') {
        return $Matches[1]
    }

    if ($id -match '^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$') {
        return $id
    }

    return $null
}

function Decode-JwtPayload {
    param([string]$Token)

    try {
        $parts = $Token.Split(".")
        if ($parts.Count -ne 3) {
            return $null
        }

        $payload = $parts[1].Replace("-", "+").Replace("_", "/")
        switch ($payload.Length % 4) {
            2 { $payload += "==" }
            3 { $payload += "=" }
            1 { return $null }
        }

        $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
        return $json | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-HttpErrorMessage {
    param([object]$ErrorRecord)

    $message = [string]$ErrorRecord.Exception.Message
    try {
        if ($ErrorRecord.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream())
            $responseText = $reader.ReadToEnd()
            $reader.Close()
            if (-not [string]::IsNullOrWhiteSpace($responseText)) {
                try {
                    $body = $responseText | ConvertFrom-Json -ErrorAction Stop
                    if (-not [string]::IsNullOrWhiteSpace([string]$body.detail)) {
                        return "$message; server said: $($body.detail)"
                    }
                    if (-not [string]::IsNullOrWhiteSpace([string]$body.error)) {
                        return "$message; server said: $($body.error)"
                    }
                } catch {}
                return "$message; server said: $responseText"
            }
        }
    } catch {}
    return $message
}

Write-Host "--- STARFLEET LAPTOP DIAGNOSTIC ---"

if (-not (Test-Path $ConfigPath)) {
    Write-Host "FAIL: Missing config at $ConfigPath"
    exit 1
}

$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$apiBase = ([string]$config.ApiBase).TrimEnd("/")
$headers = @{
    Authorization = "Bearer $($config.ApiToken)"
    Accept = "application/json"
}

$tokenPayload = Decode-JwtPayload -Token ([string]$config.ApiToken)
if ($null -eq $tokenPayload) {
    Write-Host "WARN: configured ApiToken is not a readable JWT."
} else {
    $expires = "no exp claim"
    if ($tokenPayload.exp) {
        try {
            $expiresAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$tokenPayload.exp).UtcDateTime
            $expires = $expiresAt.ToString("yyyy-MM-ddTHH:mm:ssZ")
            if ($expiresAt -le (Get-Date).ToUniversalTime()) {
                Write-Host "FAIL: configured ApiToken is expired; role=$($tokenPayload.role), site_id=$($tokenPayload.site_id), expired=$expires"
            }
        } catch {
            $expires = "invalid exp claim"
        }
    }
    Write-Host "INFO: token role=$($tokenPayload.role), site_id=$($tokenPayload.site_id), expires=$expires"
    if ($tokenPayload.role -ne "agent") {
        Write-Host "WARN: token role is not agent; generate a site-scoped agent token from /api/agent-tokens."
    }
}

Write-Host "[1/4] Checking backend auth and site access..."
try {
    $sites = Invoke-RestMethod -Uri "$apiBase/api/sites" -Headers $headers -TimeoutSec 15
    Write-Host "PASS: backend reachable; $($sites.Count) sites returned."
} catch {
    Write-Host "FAIL: backend request failed: $(Get-HttpErrorMessage -ErrorRecord $_)"
}

Write-Host "[2/4] Checking scheduled task..."
$task = Get-ScheduledTask -TaskName "StarfleetPulse" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "PASS: StarfleetPulse task exists with state $($task.State)."
} else {
    Write-Host "FAIL: StarfleetPulse task is missing."
}

Write-Host "[3/4] Checking latest heartbeat..."
$lastHeartbeat = Join-Path $DataDir "last_heartbeat.txt"
if (Test-Path $lastHeartbeat) {
    Write-Host "PASS: last successful heartbeat: $(Get-Content $lastHeartbeat -Raw)"
} else {
    Write-Host "WARN: no successful heartbeat recorded yet."
}

Write-Host "[4/4] Checking Starlink gRPC-web location access..."
$grpcPayload = [byte[]](0x00, 0x00, 0x00, 0x00, 0x04, 0x82, 0xF7, 0x02, 0x00)
$grpcWebUrl = "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle"

try {
    $response = Invoke-WebRequest -Uri $grpcWebUrl `
        -Method Post `
        -Body $grpcPayload `
        -ContentType "application/grpc-web+proto" `
        -Headers @{
            "X-Grpc-Web" = "1"
            "Accept" = "application/grpc-web+proto"
        } `
        -UseBasicParsing `
        -TimeoutSec 8

    $rawBytes = $response.Content
    if ($rawBytes -is [string]) {
        $rawBytes = [System.Text.Encoding]::GetEncoding(28591).GetBytes($rawBytes)
    }

    $starlinkId = Find-StarlinkUtIdInBytes -Bytes $rawBytes
    $starlinkUuid = Normalize-StarlinkId $starlinkId

    $lat = [Math]::Round([System.BitConverter]::ToDouble($rawBytes, 96), 5)
    $lon = [Math]::Round([System.BitConverter]::ToDouble($rawBytes, 105), 5)
    $azimuth = $null
    $elevation = $null
    if ($rawBytes.Length -ge 153) {
        $azimuth = [Math]::Round([System.BitConverter]::ToSingle($rawBytes, 144), 2)
        $elevation = [Math]::Round([System.BitConverter]::ToSingle($rawBytes, 149), 2)
    }

    if ($lat -ge -90 -and $lat -le 90 -and $lon -ge -180 -and $lon -le 180) {
        Write-Host "PASS: Starlink gRPC-web GPS lat=$lat, lon=$lon, azimuth=$azimuth, elevation=$elevation, id=$starlinkId, uuid=$starlinkUuid"
        exit 0
    }

    if (-not [string]::IsNullOrWhiteSpace($starlinkUuid)) {
        Write-Host "PASS: Starlink gRPC-web ID id=$starlinkId, uuid=$starlinkUuid; GPS offsets were unavailable."
        exit 0
    }

    Write-Host "WARN: gRPC-web responded, but GPS offsets were outside valid ranges."
} catch {
    Write-Host "WARN: Starlink gRPC-web location probe failed: $($_.Exception.Message)"
}

Write-Host "Checking grpcurl fallback..."
$grpcurl = Join-Path $DataDir "grpcurl.exe"
$cmd = Get-Command "grpcurl" -ErrorAction SilentlyContinue
if ($cmd) {
    $grpcurl = $cmd.Source
}

if (-not (Test-Path $grpcurl)) {
    Write-Host "WARN: grpcurl not found; heartbeat/health/latency still work, Starlink dish metrics are skipped."
    exit 0
}

try {
    $raw = & $grpcurl "-plaintext" "-d" '{"get_location":{}}' "192.168.100.1:9200" "SpaceX.API.Device.Device/Handle" 2>$null
    $loc = ($raw | Out-String) | ConvertFrom-Json
    if ($loc.getLocation.lla.lat) {
        Write-Host "PASS: Starlink GPS lat=$($loc.getLocation.lla.lat), lon=$($loc.getLocation.lla.lon)"
    } else {
        Write-Host "WARN: gRPC responded, but no GPS lock was present."
    }
} catch {
    Write-Host "WARN: unable to reach Starlink dish at 192.168.100.1:9200."
}
