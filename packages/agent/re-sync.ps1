#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$QueueFile,

    [string]$ConfigPath = "C:\ProgramData\Starfleet\agent.config.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $QueueFile)) {
    throw "Queue file not found: $QueueFile"
}
if (-not (Test-Path $ConfigPath)) {
    throw "Config file not found: $ConfigPath"
}

$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$item = Get-Content -Path $QueueFile -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($config.ApiBase) -or [string]::IsNullOrWhiteSpace($config.ApiToken)) {
    throw "Config ApiBase and ApiToken are required."
}
if ([string]::IsNullOrWhiteSpace($item.endpoint)) {
    throw "Queue file is missing endpoint."
}

$headers = @{
    Authorization = "Bearer $($config.ApiToken)"
    "Content-Type" = "application/json"
    Accept = "application/json"
}
$body = $item.payload | ConvertTo-Json -Depth 12 -Compress
$apiBase = ([string]$config.ApiBase).TrimEnd("/")

try {
    $res = Invoke-WebRequest -Uri "$apiBase/ingest/$($item.endpoint)" -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30
    Write-Host "SUCCESS: HTTP $($res.StatusCode)"
} catch {
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "SERVER REJECTED PAYLOAD: $($reader.ReadToEnd())"
    } else {
        Write-Host "NETWORK ERROR: $($_.Exception.Message)"
    }
    exit 1
}
