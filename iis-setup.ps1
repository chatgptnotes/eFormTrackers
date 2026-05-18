# =====================================================================
#  FlowAccel - IIS setup / fix script
#  >>> RUN AS ADMINISTRATOR <<<
#  (Start -> type PowerShell -> right-click -> "Run as administrator")
#
#  Fixes the 403.14 error by pointing the port-8081 site to dist\
# =====================================================================

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteRoot = 'C:\Website\flowaccel\dist'
$port     = 8081
$appcmd   = "$env:windir\system32\inetsrv\appcmd.exe"

# --- Admin check -----------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) { throw "NOT running as Administrator. Close this and re-open PowerShell as administrator." }

if (-not (Test-Path "$siteRoot\web.config")) { throw "web.config missing in $siteRoot" }
if (-not (Test-Path "$siteRoot\index.html")) { throw "index.html missing in $siteRoot" }

# --- Show every site so we can see what is happening -----------------------
Write-Host "=== Current IIS sites ===" -ForegroundColor Yellow
Get-Website | Select-Object Name, State,
    @{n='Bindings';e={ ($_.bindings.Collection.bindingInformation) -join ' , ' }},
    PhysicalPath | Format-Table -AutoSize

# 1. Enable ARR reverse proxy -----------------------------------------------
Write-Host "[1/5] Enabling ARR reverse proxy..." -ForegroundColor Cyan
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost

# 2. Find / create the site on port 8081 ------------------------------------
Write-Host "[2/5] Locating site bound to port $port..." -ForegroundColor Cyan
$site = Get-Website | Where-Object {
    ($_.bindings.Collection | Where-Object { $_.bindingInformation -like "*:$port:*" })
} | Select-Object -First 1

if ($site) {
    Write-Host "      Site '$($site.Name)' currently -> $($site.PhysicalPath)"
    Set-ItemProperty "IIS:\Sites\$($site.Name)" -Name physicalPath -Value $siteRoot
    Write-Host "      Repointed '$($site.Name)' -> $siteRoot" -ForegroundColor Green
} else {
    Write-Host "      No site on port $port - creating 'FlowAccel'"
    New-Website -Name 'FlowAccel' -Port $port -PhysicalPath $siteRoot -Force | Out-Null
    $site = Get-Website -Name 'FlowAccel'
}

# 3. App pool -> No Managed Code --------------------------------------------
Write-Host "[3/5] App pool '$($site.applicationPool)' -> No Managed Code..." -ForegroundColor Cyan
Set-ItemProperty "IIS:\AppPools\$($site.applicationPool)" -Name managedRuntimeVersion -Value ''

# 4. Folder permissions ------------------------------------------------------
Write-Host "[4/5] Granting IIS_IUSRS read access..." -ForegroundColor Cyan
icacls $siteRoot /grant "IIS_IUSRS:(OI)(CI)RX" /T | Out-Null

# 5. Restart -----------------------------------------------------------------
Write-Host "[5/5] Restarting IIS..." -ForegroundColor Cyan
Start-Website -Name $site.Name -ErrorAction SilentlyContinue
iisreset /restart | Out-Null

Write-Host ""
Write-Host "DONE -> Site '$($site.Name)'  Port $port  Root $siteRoot" -ForegroundColor Green
Write-Host "Open: http://192.168.8.127:$port/" -ForegroundColor Green
