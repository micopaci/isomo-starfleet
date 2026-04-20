# Starfleet Detection Script v2.1
$DataDir = "C:\ProgramData\Starfleet"
$AgentPath = "$DataDir\StarfleetAgent.ps1"
$BinaryPath = "$DataDir\grpcurl.exe"
$TaskName = "StarfleetPulse"

# 1. Check for core files
if (-not (Test-Path $AgentPath) -or -not (Test-Path $BinaryPath)) {
    Write-Host "Missing agent files."
    exit 1
}

# 2. Check for Scheduled Task
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Scheduled task not found."
    exit 1
}

# 3. Optional: Check for recent activity (last 1 hour)
$logFile = "$DataDir\agent.log"
if (Test-Path $logFile) {
    $lastWrite = (Get-Item $logFile).LastWriteTime
    if ($lastWrite -lt (Get-Date).AddHours(-1)) {
        Write-Host "Agent hasn't logged data recently."
        exit 1
    }
}

Write-Host "Agent is healthy and active."
exit 0