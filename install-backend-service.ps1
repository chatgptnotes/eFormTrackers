# =====================================================================
#  FlowAccel - install backend as a Windows Scheduled Task
#  Run this file. It auto-asks for Administrator (click YES on UAC).
#
#  Result: backend starts on every boot, auto-restarts if it crashes.
# =====================================================================

# --- Auto-elevate ----------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Asking for Administrator rights... click YES on the popup." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoExit','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
    exit
}

$ErrorActionPreference = 'Stop'
$taskName = 'FlowAccel Backend'
$wrapper  = 'C:\Website\flowaccel\backend\run-backend.cmd'

Write-Host "`n========= FlowAccel Backend Service Install =========`n" -ForegroundColor Green
if (-not (Test-Path $wrapper)) { throw "Missing: $wrapper" }

# 1. Stop anything currently running ----------------------------------------
Write-Host "[1/4] Stopping any running backend / old task..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process run-backend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2. Register the scheduled task --------------------------------------------
Write-Host "[2/4] Registering scheduled task '$taskName'..." -ForegroundColor Cyan
$action    = New-ScheduledTaskAction -Execute $wrapper
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                 -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
                       -Principal $principal -Settings $settings -Force | Out-Null

# 3. Start it now -----------------------------------------------------------
Write-Host "[3/4] Starting backend now..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8

# 4. Test -------------------------------------------------------------------
Write-Host "[4/4] Testing endpoints..." -ForegroundColor Cyan
function Test-Url($u) {
    try { $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 8; return "OK ($($r.StatusCode))" }
    catch { return "FAIL - $($_.Exception.Message)" }
}
$listening = (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
$site   = Test-Url "http://localhost:8081/"
$api    = Test-Url "http://localhost:3001/api/health"
$proxy  = Test-Url "http://localhost:8081/api/health"

Write-Host "`n================= RESULT =================" -ForegroundColor Green
Write-Host ("  Backend on port 3001 : {0}" -f $(if($listening){'LISTENING'}else{'NOT running'}))
Write-Host ("  Website  8081/       : {0}" -f $site)
Write-Host ("  Backend  3001/api    : {0}" -f $api)
Write-Host ("  Proxy    8081/api    : {0}" -f $proxy)
Write-Host "==========================================`n" -ForegroundColor Green
Write-Host "Open in browser:  http://192.168.8.127:8081/" -ForegroundColor Green
Write-Host "Backend log: C:\Website\flowaccel\backend\logs\backend.log" -ForegroundColor DarkGray
Write-Host "If Backend FAILED -> database not set up: run  cd C:\Website\flowaccel\backend ; node db\migrate.js" -ForegroundColor DarkGray
