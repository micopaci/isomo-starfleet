Write-Host "--- STARFLEET DIAGNOSTIC ---" -ForegroundColor Cyan

# 1. Test grpcurl & Starlink GPS
Write-Host "[1/2] Checking Starlink gRPC (GPS)..." -ForegroundColor Gray
try {
    $locRaw = grpcurl --% -plaintext -d "{\"get_location\":{}}" 192.168.100.1:9200 SpaceX.API.Device.Device/Handle | ConvertFrom-Json
    if ($locRaw.getLocation.lla.lat) {
        Write-Host "SUCCESS: lat=$($locRaw.getLocation.lla.lat), lon=$($locRaw.getLocation.lla.lon)" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Connection ok, but dish has no GPS lock." -ForegroundColor Yellow
    }
} catch {
    Write-Host "FAILURE: grpcurl could not reach dish (192.168.100.1:9200)." -ForegroundColor Red
}

# 2. Test Railway API & JWT
Write-Host "`n[2/2] Checking Railway Auth & Site Discovery..." -ForegroundColor Gray
$Token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiYWRtaW4AdGVzdC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzY2OTEwMjMsImV4cCI6MTgwODIyNzAyM30.lKvEgZlhZku-L6bOsEGqJjBnrhNrLcm5FR8BMbVI588"
try {
    $headers = @{ Authorization = "Bearer $Token"; "Accept" = "application/json" }
    $sites = Invoke-RestMethod -Uri "https://api.starfleet.icircles.rw/api/sites" -Headers $headers -TimeoutSec 15
    Write-Host "SUCCESS: Connected to Railway. Found $($sites.Count) sites." -ForegroundColor Green
} catch {
    $err = if ($_.Exception.Response) { (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } else { $_.Exception.Message }
    Write-Host "FAILURE: $err" -ForegroundColor Red
}