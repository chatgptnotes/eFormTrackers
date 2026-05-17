#Requires -RunAsAdministrator
<#
  JotFlow — Post-reboot IIS Setup Script
  Run this ONCE as Administrator after rebooting the machine.

  What it does:
  1. Starts IIS services
  2. Repairs ARR 3.0 installation
  3. Enables ARR reverse proxy
  4. Configures IIS site (FlowAccel) pointing to dist/
  5. Starts the Node.js backend via the scheduled task
  6. Verifies everything works

  Usage:
    Right-click PowerShell > Run as Administrator
    cd C:\Users\NODE08\Documents\Flowaccel\jotformTest14march
    .\setup-after-reboot.ps1
#>

Write-Host "`n==== JotFlow IIS Setup ====" -ForegroundColor Cyan
Write-Host ""

# -- Step 1: Ensure IIS services are running --
Write-Host "[1/6] Starting IIS services..." -ForegroundColor Yellow
Start-Service WAS -ErrorAction SilentlyContinue
Start-Service W3SVC -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$w3svc = Get-Service W3SVC
if ($w3svc.Status -ne 'Running') {
    Write-Host "  ERROR: W3SVC not running. Status: $($w3svc.Status)" -ForegroundColor Red
    Write-Host "  Trying net start..." -ForegroundColor Yellow
    net start w3svc
    Start-Sleep -Seconds 2
    $w3svc = Get-Service W3SVC
    if ($w3svc.Status -ne 'Running') {
        Write-Host "  FATAL: Cannot start IIS. Check Event Viewer." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  W3SVC is running." -ForegroundColor Green

# -- Step 2: Install/Repair ARR 3.0 --
Write-Host "[2/6] Installing ARR 3.0..." -ForegroundColor Yellow
$arrMsi = "C:\temp\arr3.msi"
if (-not (Test-Path $arrMsi)) {
    Write-Host "  Downloading ARR 3.0..." -ForegroundColor Gray
    Invoke-WebRequest -Uri "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" -OutFile $arrMsi
}
$proc = Start-Process msiexec -ArgumentList "/i `"$arrMsi`" /qn" -Wait -PassThru
if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 1638) {
    Write-Host "  ARR 3.0 installed." -ForegroundColor Green
} else {
    Write-Host "  ARR install exit code: $($proc.ExitCode) (may already be installed)" -ForegroundColor Yellow
}

# -- Step 3: Enable ARR Proxy --
Write-Host "[3/6] Enabling ARR proxy..." -ForegroundColor Yellow
$appcmd = "$env:windir\System32\inetsrv\appcmd.exe"
if (Test-Path $appcmd) {
    & $appcmd set config -section:system.webServer/proxy /enabled:true /preserveHostHeader:true /commit:apphost 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ARR proxy enabled via appcmd." -ForegroundColor Green
    } else {
        Write-Host "  appcmd failed. Enabling via applicationHost.config..." -ForegroundColor Yellow
        $appHostPath = "$env:windir\System32\inetsrv\config\applicationHost.config"
        [xml]$appHost = Get-Content $appHostPath
        $ws = $appHost.configuration.'system.webServer'
        $existingProxy = $ws.proxy
        if (-not $existingProxy) {
            $proxy = $appHost.CreateElement('proxy')
            $proxy.SetAttribute('enabled', 'true')
            $proxy.SetAttribute('preserveHostHeader', 'true')
            $ws.AppendChild($proxy) | Out-Null
            $appHost.Save($appHostPath)
            Write-Host "  ARR proxy enabled via config edit." -ForegroundColor Green
        } else {
            $existingProxy.SetAttribute('enabled', 'true')
            $appHost.Save($appHostPath)
            Write-Host "  ARR proxy already exists, ensured enabled." -ForegroundColor Green
        }
    }
} else {
    Write-Host "  WARNING: appcmd.exe not found!" -ForegroundColor Red
}

# -- Step 4: Configure IIS site --
Write-Host "[4/6] Configuring IIS site..." -ForegroundColor Yellow
Import-Module WebAdministration -ErrorAction Stop

$siteName = "FlowAccel"
$sitePath = "C:\inetpub\flowaccel\dist"
$port = 80

# Stop default website
$defaultSite = Get-Website -Name "Default Web Site" -ErrorAction SilentlyContinue
if ($defaultSite) {
    Stop-Website -Name "Default Web Site" -ErrorAction SilentlyContinue
    Remove-WebBinding -Name "Default Web Site" -Port 80 -ErrorAction SilentlyContinue
    Write-Host "  Stopped 'Default Web Site'" -ForegroundColor Gray
}

# Create or update FlowAccel site
$existing = Get-Website -Name $siteName -ErrorAction SilentlyContinue
if ($existing) {
    Set-ItemProperty "IIS:\Sites\$siteName" -Name physicalPath -Value $sitePath
    Start-Website -Name $siteName -ErrorAction SilentlyContinue
    Write-Host "  Updated existing site '$siteName' -> $sitePath" -ForegroundColor Green
} else {
    New-Website -Name $siteName -PhysicalPath $sitePath -Port $port -Force | Out-Null
    Write-Host "  Created site '$siteName' on port $port -> $sitePath" -ForegroundColor Green
}

# Ensure web.config is in dist/
Copy-Item "C:\inetpub\flowaccel\web.config" "$sitePath\web.config" -Force
Write-Host "  web.config placed in dist\" -ForegroundColor Gray

# -- Step 5: Start backend --
Write-Host "[5/6] Starting Node.js backend..." -ForegroundColor Yellow
$backendRunning = $false
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 3
    $backendRunning = $true
    Write-Host "  Backend already running (uptime: $([math]::Round($health.uptime))s)" -ForegroundColor Green
} catch {
    Write-Host "  Backend not running. Starting via scheduled task..." -ForegroundColor Gray
    schtasks /run /tn "JotFlow Backend" 2>$null
    Start-Sleep -Seconds 4
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5
        $backendRunning = $true
        Write-Host "  Backend started successfully." -ForegroundColor Green
    } catch {
        Write-Host "  Starting backend manually..." -ForegroundColor Yellow
        Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "C:\inetpub\flowaccel\backend" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5
            $backendRunning = $true
            Write-Host "  Backend started manually." -ForegroundColor Green
        } catch {
            Write-Host "  ERROR: Backend failed to start!" -ForegroundColor Red
        }
    }
}

# -- Step 6: Verify --
Write-Host "[6/6] Verifying..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Check backend
if ($backendRunning) {
    Write-Host "  [OK] Backend (port 3001): Running" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Backend (port 3001): Not responding" -ForegroundColor Red
}

# Check IIS frontend
try {
    $resp = Invoke-WebRequest -Uri "http://localhost/" -TimeoutSec 5 -UseBasicParsing
    if ($resp.StatusCode -eq 200 -and $resp.Content -match 'FlowAccel') {
        Write-Host "  [OK] Frontend (port 80): Serving FlowAccel" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Frontend (port 80): Status $($resp.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [FAIL] Frontend (port 80): $($_.Exception.Message)" -ForegroundColor Red
}

# Check API via IIS proxy
try {
    $apiResp = Invoke-RestMethod -Uri "http://localhost/api/health" -TimeoutSec 5
    Write-Host "  [OK] API proxy (/api/health): Working" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] API proxy (/api/health): $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  If proxy fails, manually enable in IIS Manager:" -ForegroundColor Yellow
    Write-Host "    1. Click server name (top level)" -ForegroundColor Gray
    Write-Host "    2. Open 'Application Request Routing Cache'" -ForegroundColor Gray
    Write-Host "    3. Click 'Server Proxy Settings' (right pane)" -ForegroundColor Gray
    Write-Host "    4. Check 'Enable proxy' -> Apply" -ForegroundColor Gray
}

Write-Host ""
Write-Host "==== Setup Complete ====" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend:  http://localhost" -ForegroundColor White
Write-Host "  API:       http://localhost/api/health" -ForegroundColor White
Write-Host "  Backend:   http://localhost:3001" -ForegroundColor White
Write-Host ""
