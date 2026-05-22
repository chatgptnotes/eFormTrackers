# ============================================================================
#  FlowAccel - Self-contained IIS install via iisnode  (RUN AS ADMINISTRATOR)
#
#  Result: a single IIS site at http://localhost/ where IIS itself launches and
#  manages the Node backend (server.js). server.js serves the React build,
#  the REST API, /uploads and Socket.IO in one process. No PM2, no extra port.
#
#  What this script does (idempotent - safe to re-run):
#    1. Verify Administrator + Node.js
#    2. Enable IIS WebSockets feature (Socket.IO)
#    3. Install the iisnode module if it is missing (downloads the MSI)
#    4. Stop any PM2 backend so there is only one backend
#    5. Deploy server.js + web.config + dist\ + backend\ to C:\inetpub\flowaccel
#    6. Grant the app-pool identity the rights it needs (incl. uploads/logs RW)
#    7. (Re)create the FlowAccel app pool + site on port 80 and start it
#    8. Health check http://localhost/api/health
#
#  Prerequisites already in place on this machine:
#    - PostgreSQL running with the 'jotflow' database (schema applied, admin seeded)
#    - URL Rewrite + ARR modules installed
#    - backend\.env present (DATABASE_URL, SESSION_SECRET, etc.)
# ============================================================================

$ErrorActionPreference = 'Stop'
$src     = $PSScriptRoot                       # repo folder (this script's location)
$site    = 'C:\inetpub\flowaccel'
$pool    = 'FlowAccel'
$appcmd  = "$env:windir\system32\inetsrv\appcmd.exe"
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$iisnodeMsiUrl = 'https://github.com/Azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi'

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK]  $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]   $m"   -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [X]   $m"   -ForegroundColor Red; exit 1 }

# -- 0. Elevation ------------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die 'Not running as Administrator. Right-click PowerShell -> Run as Administrator, then re-run this script.'
}
Ok 'Administrator confirmed'

if (-not (Test-Path $nodeExe)) { Die "Node.js not found at $nodeExe. Install Node 18+ and re-run." }
Ok "Node found: $nodeExe"

# -- 1. IIS WebSockets feature ----------------------------------------------
Step '1/8  Enabling IIS WebSockets feature'
$ws = Get-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -ErrorAction SilentlyContinue
if ($ws -and $ws.State -ne 'Enabled') {
  Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -NoRestart -ErrorAction SilentlyContinue | Out-Null
  Ok 'IIS-WebSockets enabled'
} else { Ok 'IIS-WebSockets already enabled' }

# -- 2. iisnode module -------------------------------------------------------
Step '2/8  Ensuring iisnode module is installed'
if (Test-Path 'C:\Program Files\iisnode\iisnode.dll') {
  Ok 'iisnode already installed'
} else {
  $msi = Join-Path $env:TEMP 'iisnode-full-x64.msi'
  Warn 'iisnode not found - downloading...'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $iisnodeMsiUrl -OutFile $msi -UseBasicParsing
  } catch { Die "Failed to download iisnode MSI: $($_.Exception.Message). Download it manually from $iisnodeMsiUrl, install it, then re-run." }
  Warn 'installing iisnode (silent)...'
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Die "iisnode MSI install failed (exit $($p.ExitCode))." }
  if (-not (Test-Path 'C:\Program Files\iisnode\iisnode.dll')) { Die 'iisnode install reported success but iisnode.dll is missing.' }
  Ok 'iisnode installed'
}

# -- 3. Stop PM2 backend (avoid a second backend) ---------------------------
Step '3/8  Stopping any standalone PM2 backend'
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
  pm2 delete jotflow-backend 2>$null | Out-Null
  Ok 'PM2 jotflow-backend stopped (if it was running)'
} else { Ok 'PM2 not present - nothing to stop' }

# -- 4. Deploy files ---------------------------------------------------------
Step '4/8  Deploying files to ' + $site
if (-not (Test-Path $site)) { New-Item -ItemType Directory -Path $site | Out-Null }

# Clean only the parts we own; keep nothing stale that could shadow new build
foreach ($d in 'dist','backend') {
  if (Test-Path (Join-Path $site $d)) { Remove-Item (Join-Path $site $d) -Recurse -Force -ErrorAction SilentlyContinue }
}
Remove-Item (Join-Path $site 'web.config') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $site 'server.js')  -Force -ErrorAction SilentlyContinue

# robocopy dist and backend (backend includes node_modules, .env, uploads)
robocopy "$src\dist"    "$site\dist"    /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\backend" "$site\backend" /MIR /NFL /NDL /NJH /NJS /NP `
  /XD "$src\backend\logs" | Out-Null
# (logs are recreated empty below; do not mirror old logs)

Copy-Item "$src\server.js"           "$site\server.js"  -Force
Copy-Item "$src\web.iisnode.config"  "$site\web.config" -Force

# Ensure writable runtime dirs exist
New-Item -ItemType Directory -Force -Path "$site\backend\uploads\avatars"    | Out-Null
New-Item -ItemType Directory -Force -Path "$site\backend\uploads\signatures" | Out-Null
New-Item -ItemType Directory -Force -Path "$site\backend\logs"               | Out-Null
New-Item -ItemType Directory -Force -Path "$site\iisnode"                    | Out-Null
$fileCount = (Get-ChildItem $site -Recurse -File -ErrorAction SilentlyContinue).Count
Ok "deployed ($fileCount files); web.config (iisnode) + server.js placed"

# -- 5. App pool -------------------------------------------------------------
Step '5/8  Creating app pool (No Managed Code)'
& $appcmd delete apppool $pool 2>$null | Out-Null
& $appcmd add apppool /name:$pool /managedRuntimeVersion:'' /startMode:'AlwaysRunning' 2>$null | Out-Null
# Keep the worker process alive so the Node backend is always warm
& $appcmd set apppool $pool /processModel.idleTimeout:'00:00:00' 2>$null | Out-Null
& $appcmd set apppool $pool /recycling.periodicRestart.time:'00:00:00' 2>$null | Out-Null
Ok "app pool '$pool' ready (AlwaysRunning, no idle timeout)"

# -- 6. Permissions ----------------------------------------------------------
Step '6/8  Granting permissions to the app-pool identity'
$identity = "IIS AppPool\$pool"
& icacls $site /grant "${identity}:(OI)(CI)RX" /T /Q 2>$null | Out-Null
& icacls $site /grant 'IIS_IUSRS:(OI)(CI)RX'    /T /Q 2>$null | Out-Null
# Read/write where the app actually writes
& icacls "$site\backend\uploads" /grant "${identity}:(OI)(CI)M" /T /Q 2>$null | Out-Null
& icacls "$site\backend\logs"    /grant "${identity}:(OI)(CI)M" /T /Q 2>$null | Out-Null
& icacls "$site\iisnode"         /grant "${identity}:(OI)(CI)M" /T /Q 2>$null | Out-Null
Ok 'permissions granted (RX site-wide; Modify on uploads/logs/iisnode)'

# -- 7. Site -----------------------------------------------------------------
Step '7/8  Creating + starting the FlowAccel site on port 80'
& $appcmd stop site 'Default Web Site' 2>$null | Out-Null   # free port 80
& $appcmd delete site $pool 2>$null | Out-Null
& $appcmd add site /name:$pool /physicalPath:"$site" /bindings:'http/*:80:' 2>$null | Out-Null
& $appcmd set site $pool "/[path='/'].applicationPool:$pool" 2>$null | Out-Null
& $appcmd start site $pool 2>$null | Out-Null
Ok "site '$pool' bound to http://*:80 and started"

# -- 8. Health check ---------------------------------------------------------
Step '8/8  Verifying'
Start-Sleep -Seconds 5   # give iisnode time to spawn node + connect to PG
$ok = $false
try {
  $h = Invoke-WebRequest 'http://localhost/api/health' -UseBasicParsing -TimeoutSec 15
  if ($h.StatusCode -eq 200) { Ok "API health: $($h.Content)"; $ok = $true }
} catch { Warn "health check failed: $($_.Exception.Message)" }
try {
  $r = Invoke-WebRequest 'http://localhost/' -UseBasicParsing -TimeoutSec 15
  Ok "frontend: HTTP $($r.StatusCode), $($r.RawContentLength) bytes"
} catch { Warn "frontend check failed: $($_.Exception.Message)" }

Write-Host ''
if ($ok) {
  Write-Host '==================================================' -ForegroundColor Green
  Write-Host ' FlowAccel is live - IIS manages the backend.'      -ForegroundColor Green
  Write-Host '   Open:   http://localhost/'                       -ForegroundColor Green
  Write-Host '   Login:  admin@flowaccel.local / Admin@12345'     -ForegroundColor Green
  Write-Host '   (the admin row already seeded in the jotflow DB)' -ForegroundColor Green
  Write-Host '==================================================' -ForegroundColor Green
} else {
  Write-Host '--------------------------------------------------' -ForegroundColor Yellow
  Write-Host ' Site deployed but API health did not return 200.'  -ForegroundColor Yellow
  Write-Host ' Check the iisnode logs:'                           -ForegroundColor Yellow
  Write-Host "   $site\iisnode\"                                  -ForegroundColor Yellow
  Write-Host ' Common causes: PostgreSQL not reachable, backend\.env missing a value.' -ForegroundColor Yellow
  Write-Host '--------------------------------------------------' -ForegroundColor Yellow
}
