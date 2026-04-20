# Update this string with the content of a file from C:\ProgramData\Starfleet\queue\
$Payload = '{"disk_usage_pct":69,"device_sn":"HGRV903","battery_pct":100,"manufacturer":"Dell Inc.","hostname":"WIN-CIO36VIR735","site_id":0,"model":"OptiPlex 3070","os":"Microsoft Windows Server 2025 Standard","timestamp_utc":"2026-04-20T13:41:05Z"}'

$Token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiYWRtaW4AdGVzdC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzY2OTEwMjMsImV4cCI6MTgwODIyNzAyM30.lKvEgZlhZku-L6bOsEGqJjBnrhNrLcm5FR8BMbVI588"

try {
    Write-Host "Attempting Manual Sync (Verbose)..." -ForegroundColor Cyan
    $headers = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }
    
    $res = Invoke-WebRequest -Uri "https://api.starfleet.icircles.rw/ingest/heartbeat" `
                             -Method POST -Headers $headers -Body $Payload -UseBasicParsing
    
    Write-Host "SUCCESS! HTTP Status: $($res.StatusCode)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response) {
        $details = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
        Write-Host "SERVER REJECTED PAYLOAD: $details" -ForegroundColor Yellow
    } else {
        Write-Host "NETWORK ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}