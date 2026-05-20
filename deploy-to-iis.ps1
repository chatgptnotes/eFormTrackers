# ===============================================================
#  FlowAccel - IIS deployment (RUN AS ADMINISTRATOR)
#
#  Serves the React build (dist/) as an IIS site on port 80 and
#  reverse-proxies /api, /socket.io, /uploads to the Node backend
#  running on localhost:3001 (started separately via PM2).
# ===============================================================

$ErrorActionPreference = 'Continue'

# Project root = folder this script lives in (portable across machines/VMs)
$src    = $PSScriptRoot
$site   = 'C:\inetpub\flowaccel'
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
$log    = "$env:TEMP\flowaccel-iis-deploy.log"

"" | Set-Content $log
function Log($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  Add-Content -Path $log -Value $line
  Write-Host $line
}

Log '=== FlowAccel IIS deploy ==='

# -- 0. Elevation check --
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Log 'ERROR: not running as Administrator. Aborting.'
  exit 1
}
Log 'elevation OK'

try {
  # -- 1. Enable IIS WebSocket feature (Socket.IO realtime) --
  $ws = Get-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -ErrorAction SilentlyContinue
  if ($ws -and $ws.State -ne 'Enabled') {
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -NoRestart -ErrorAction SilentlyContinue | Out-Null
    Log 'IIS-WebSockets feature enabled'
  } else {
    Log 'IIS-WebSockets already enabled'
  }

  # -- 2. Site folder --
  if (-not (Test-Path $site)) { New-Item -ItemType Directory -Path $site | Out-Null }
  Log "site folder ready: $site"

  # -- 3. Copy frontend build (dist/*) to site root --
  Log 'cleaning old site files...'
  Get-ChildItem $site -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Log 'copying dist\* -> site root (this may take a minute, ~395 MB installer included)...'
  Copy-Item "$src\dist\*" $site -Recurse -Force
  Copy-Item "$src\web.config" "$site\web.config" -Force
  $fileCount = (Get-ChildItem $site -Recurse -File).Count
  Log "copied $fileCount files; web.config placed"

  # -- 4. Permissions for IIS app pool identity --
  & icacls $site /grant 'IIS_IUSRS:(OI)(CI)RX' /T /Q  2>$null | Out-Null
  & icacls $site /grant 'IUSR:(OI)(CI)RX'      /T /Q  2>$null | Out-Null
  Log 'permissions granted (IIS_IUSRS, IUSR : read+execute)'

  # -- 4b. Ensure URL Rewrite + ARR modules are installed --
  # IIS cannot reverse-proxy to Node without these two add-on modules. If they
  # are missing the web.config proxy rules fail (HTTP 500.19 / 404) and login
  # never reaches the backend. Detect via registry; download+install if absent.
  function Ensure-IISModule($name, $regKey, $url) {
    if (Test-Path $regKey) { Log "$name already installed"; return }
    $msi = Join-Path $env:TEMP ((Split-Path $url -Leaf))
    Log "$name missing - downloading..."
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    } catch {
      Log "ERROR: could not download $name from $url : $($_.Exception.Message)"
      Log "Install it manually, then re-run this script."
      throw "$name download failed"
    }
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "$name install failed (exit $($p.ExitCode))" }
    if (-not (Test-Path $regKey)) { throw "$name installed but registry key still missing" }
    Log "$name installed"
  }
  Ensure-IISModule 'IIS URL Rewrite 2.1' `
    'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite' `
    'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi'
  Ensure-IISModule 'Application Request Routing 3.0' `
    'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing' `
    'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi'

  # -- 5. Enable ARR reverse proxy at the server level --
  # Without this, web.config rewrite-to-absolute-URL rules fail.
  & $appcmd set config -section:system.webServer/proxy /enabled:'True' /commit:apphost  2>$null
  Log 'ARR reverse proxy enabled (server level)'

  # -- 6. App pool (No Managed Code) --
  & $appcmd delete apppool 'FlowAccel'  2>$null | Out-Null
  & $appcmd add apppool /name:'FlowAccel' /managedRuntimeVersion:''  2>$null | Out-Null
  Log 'app pool "FlowAccel" created (No Managed Code)'

  # -- 7. Free port 80 - stop Default Web Site if present --
  & $appcmd stop site 'Default Web Site'  2>$null | Out-Null
  Log 'Default Web Site stopped (if it existed)'

  # -- 8. Create + start the site on port 80 --
  & $appcmd delete site 'FlowAccel'  2>$null | Out-Null
  & $appcmd add site /name:'FlowAccel' /physicalPath:"$site" /bindings:'http/*:80:'  2>$null | Out-Null
  & $appcmd set site 'FlowAccel' /[path=`'/`'].applicationPool:'FlowAccel'  2>$null | Out-Null
  & $appcmd start site 'FlowAccel'  2>$null | Out-Null
  Log 'site "FlowAccel" created on http://*:80 and started'

  Log '=== DONE - open http://localhost/ ==='
  exit 0
}
catch {
  Log ("ERROR: " + $_.Exception.Message)
  exit 1
}
