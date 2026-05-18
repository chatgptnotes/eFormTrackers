# =====================================================================
#  FlowAccel - ONE-CLICK host script
#  Run this file. It will auto-ask for Administrator (click YES on UAC).
#  Does everything: IIS fix (403) + backend start (502).
# =====================================================================

# --- Auto-elevate to Administrator -----------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Asking for Administrator rights... click YES on the popup." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoExit','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
    exit
}

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$root     = 'C:\Website\flowaccel'
$siteRoot = "$root\dist"
$backend  = "$root\backend"
$port     = 8081
$appcmd   = "$env:windir\system32\inetsrv\appcmd.exe"

Write-Host "`n================ FlowAccel Hosting Setup ================`n" -ForegroundColor Green

if (-not (Test-Path "$siteRoot\index.html")) { throw "index.html missing in $siteRoot" }
if (-not (Test-Path "$siteRoot\web.config")) { throw "web.config missing in $siteRoot" }

# --- Show all sites --------------------------------------------------------
Write-Host "Current IIS sites:" -ForegroundColor Yellow
Get-Website | Select-Object Name, State,
    @{n='Bindings';e={ ($_.bindings.Collection.bindingInformation) -join ' , ' }},
    PhysicalPath | Format-Table -AutoSize

# === 1. Enable ARR reverse proxy ===========================================
Write-Host "[1/7] Enabling ARR reverse proxy..." -ForegroundColor Cyan
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost

# === 2. Point the port-8081 site to dist\ ==================================
Write-Host "[2/7] Configuring IIS site on port $port..." -ForegroundColor Cyan
$site = Get-Website | Where-Object {
    ($_.bindings.Collection | Where-Object { $_.bindingInformation -like "*:$($port):*" })
} | Select-Object -First 1

if ($site) {
    Write-Host "      '$($site.Name)' was -> $($site.PhysicalPath)"
    Set-ItemProperty "IIS:\Sites\$($site.Name)" -Name physicalPath -Value $siteRoot
    Write-Host "      '$($site.Name)' now  -> $siteRoot" -ForegroundColor Green
} else {
    Write-Host "      No site on port $port - creating 'FlowAccel'"
    New-Website -Name 'FlowAccel' -Port $port -PhysicalPath $siteRoot -Force | Out-Null
    $site = Get-Website -Name 'FlowAccel'
}

# === 3. App pool -> No Managed Code ========================================
Write-Host "[3/7] App pool '$($site.applicationPool)' -> No Managed Code..." -ForegroundColor Cyan
Set-ItemProperty "IIS:\AppPools\$($site.applicationPool)" -Name managedRuntimeVersion -Value ''

# === 4. Folder permissions =================================================
Write-Host "[4/7] Granting IIS_IUSRS read access..." -ForegroundColor Cyan
icacls $siteRoot /grant "IIS_IUSRS:(OI)(CI)RX" /T | Out-Null

# === 5. Restart IIS ========================================================
Write-Host "[5/7] Restarting IIS..." -ForegroundColor Cyan
Start-Website -Name $site.Name -ErrorAction SilentlyContinue
iisreset /restart | Out-Null

# === 6. Start the Node backend with PM2 ====================================
Write-Host "[6/7] Starting Node backend (port 3001)..." -ForegroundColor Cyan
Set-Location $backend
if (-not (Test-Path "$backend\logs")) { New-Item -ItemType Directory "$backend\logs" | Out-Null }
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "      Installing PM2 (one-time)..."
    npm install -g pm2 pm2-windows-startup
    try { pm2-startup install } catch { Write-Host "      (pm2-startup skipped)" }
}
pm2 delete jotflow-backend 2>$null | Out-Null
pm2 start ecosystem.config.js
pm2 save

# === 7. Test ===============================================================
Write-Host "[7/7] Testing endpoints..." -ForegroundColor Cyan
Start-Sleep -Seconds 3
function Test-Url($u) {
    try { $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 8
          return "OK ($($r.StatusCode))" }
    catch { return "FAIL - $($_.Exception.Message)" }
}
$site8081 = Test-Url "http://localhost:$port/"
$api3001  = Test-Url "http://localhost:3001/api/health"
$apiProxy = Test-Url "http://localhost:$port/api/health"

Write-Host "`n================ RESULT ================" -ForegroundColor Green
Write-Host ("  Website  (http://localhost:$port/)        : {0}" -f $site8081)
Write-Host ("  Backend  (http://localhost:3001/api/...)  : {0}" -f $api3001)
Write-Host ("  Proxy    (http://localhost:$port/api/...) : {0}" -f $apiProxy)
Write-Host "========================================`n" -ForegroundColor Green
Write-Host "Open in browser:  http://192.168.8.127:$port/" -ForegroundColor Green
Write-Host "(If backend FAILED, the database may need: cd $backend ; node db\migrate.js)" -ForegroundColor DarkGray
