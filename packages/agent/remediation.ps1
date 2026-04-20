# Starfleet Remediation Script v5.6
$DataDir = "C:\ProgramData\Starfleet"
$AgentPath = "$DataDir\StarfleetAgent.ps1"
$TaskName = "StarfleetPulse"

# 1. Setup Environment
if (-not (Test-Path $DataDir)) { New-Item $DataDir -ItemType Directory -Force }

# 2. Deploy Agent Script (v5.6 Code)
$AgentCode = @'
# [PASTE THE FULL CONTENT OF STARFLEETAGENT.PS1 V5.6 HERE]
# Ensure the $ApiToken inside matches your verified clean token.
'@

Set-Content -Path $AgentPath -Value $AgentCode -Encoding UTF8

# 3. Configure Scheduled Task (Run as SYSTEM every 15 mins)
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Unregister if exists to ensure clean update
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Register the new task
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings

# 4. Trigger initial run to populate Discovery/Neon
Start-ScheduledTask -TaskName $TaskName
Write-Host "Remediation complete: Agent deployed and task scheduled."