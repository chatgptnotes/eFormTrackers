# install.ps1 - FlowAccel master orchestrator (25 steps, idempotent).
#
# Invoked by Inno Setup [Run] section as:
#   powershell -ExecutionPolicy Bypass -NoProfile -File install.ps1 -ConfigPath <path>
#
# Or standalone:
#   .\install.ps1 -ConfigPath C:\path\to\config.json [-Resume]

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [switch]$Resume,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ----- Bootstrap: dot-source libraries -----
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$libDir = Join-Path $here 'lib'
foreach ($mod in 'log','prereq','iis','node','postgres','site','service','firewall','verify','admin-seed','auto-remediate') {
    . (Join-Path $libDir "$mod.ps1")
}

# ----- Load config -----
if (-not (Test-Path $ConfigPath)) { throw "Config file not found: $ConfigPath" }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

# Materialize log file inside install dir
$installDir = $cfg.InstallDir
if (-not $installDir) { throw 'InstallDir not set in config.json' }
$logFile = Join-Path $installDir ("logs\install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Initialize-Log -Path $logFile
Write-Log -Level INFO -Message "FlowAccel installer starting. Config: $ConfigPath"
Write-Log -Level INFO -Message "Install dir: $installDir"
if ($Resume) { Write-Log -Level INFO -Message 'Resume mode after reboot.' }
if ($DryRun) { Write-Log -Level INFO -Message 'DRY-RUN: actions will be logged but not executed.' }

# Detect the machine's primary IPv4 - used only for display and the closing
# "open http://<ip>/" message. Nothing IP-specific is baked into the app: IIS
# binds every interface and the SPA uses relative URLs, so FlowAccel works on
# whatever IP this machine has, even after the IP changes.
function Get-PrimaryIPv4 {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
              Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch {}
    return '127.0.0.1'
}
$primaryIp = Get-PrimaryIPv4
Write-Log -Level INFO -Message "Primary IPv4 detected: $primaryIp (display only)"

# Convenience hashtable for downstream functions
$config = @{
    InstallDir            = $cfg.InstallDir
    HttpPort              = if ($cfg.HttpPort) { [int]$cfg.HttpPort } else { 80 }
    BackendPort           = if ($cfg.BackendPort) { [int]$cfg.BackendPort } else { 3001 }
    PgPort                = if ($cfg.PgPort) { [int]$cfg.PgPort } else { 5432 }
    PgSuperPassword       = $cfg.PgSuperPassword
    AppDbPassword         = $cfg.AppDbPassword
    DbUser                = if ($cfg.DbUser) { $cfg.DbUser } else { 'jotflow' }
    DbName                = if ($cfg.DbName) { $cfg.DbName } else { 'jotflow' }
    SessionSecret         = $cfg.SessionSecret
    JotformApiKey         = $cfg.JotformApiKey
    JotformTeamId         = $cfg.JotformTeamId
    JotformBase           = $cfg.JotformBase
    JotformHost           = $cfg.JotformHost
    JotformWebhookSecret  = $cfg.JotformWebhookSecret
    AdminEmail            = if ($cfg.AdminEmail) { ($cfg.AdminEmail).ToLower() } else { '' }
    AdminPassword         = $cfg.AdminPassword
    AdminName             = if ($cfg.AdminName) { $cfg.AdminName } else { 'Administrator' }
    MicrosoftClientId     = $cfg.MicrosoftClientId
    MicrosoftTenantId     = $cfg.MicrosoftTenantId
    MicrosoftClientSecret = $cfg.MicrosoftClientSecret
    MicrosoftRedirectUri  = if ($cfg.MicrosoftRedirectUri) { $cfg.MicrosoftRedirectUri } else { "http://$primaryIp/api/auth/microsoft/callback" }
    AllowIcmp             = if ($null -ne $cfg.AllowIcmp) { [bool]$cfg.AllowIcmp } else { $true }
    SiteName              = 'FlowAccel'
    AppPoolName           = 'FlowAccelPool'
    ServiceName           = 'FlowAccelBackend'
}

# Resolve payload root (sibling of scripts/)
$payloadRoot = Split-Path -Parent $here
$installersDir = Join-Path $payloadRoot 'installers'
$payloadAppDir = Join-Path $payloadRoot 'app'

# ===== STEP 0: Pre-flight =====
Invoke-PreflightChecks -MinDiskGB 10

# ===== STEP 2a: VC++ Redist =====
Install-VCRedist -InstallerPath (Join-Path $installersDir 'VC_redist.x64.exe')

# ===== STEP 2b: IIS features =====
$iisResult = Install-IISFeatures
if ($iisResult.RestartRequired) {
    # Drop a desktop resume shortcut and surface message to operator.
    $resumeCmd = "powershell -ExecutionPolicy Bypass -NoProfile -File `"$($MyInvocation.MyCommand.Path)`" -ConfigPath `"$ConfigPath`" -Resume"
    $shortcut = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Continue FlowAccel Setup.lnk'
    try {
        $sh = New-Object -ComObject WScript.Shell
        $lnk = $sh.CreateShortcut($shortcut)
        $lnk.TargetPath = 'powershell.exe'
        $lnk.Arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$($MyInvocation.MyCommand.Path)`" -ConfigPath `"$ConfigPath`" -Resume"
        $lnk.IconLocation = 'powershell.exe,0'
        $lnk.Save()
    } catch {}
    Write-Banner -Status STOP -Message 'Reboot required to finish enabling IIS. After reboot, double-click "Continue FlowAccel Setup" on the desktop.'
    exit 1618   # ERROR_INSTALL_ALREADY_RUNNING - reboot pending; Inno will surface a clean message.
}

# ===== STEP 3-4: URL Rewrite + ARR =====
Install-IISModule -Name 'IIS URL Rewrite 2.1' `
    -RegistryKey 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite' `
    -MsiPath (Join-Path $installersDir 'rewrite_amd64_en-US.msi') `
    -Step 3
Install-IISModule -Name 'Application Request Routing 3.0' `
    -RegistryKey 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing' `
    -MsiPath (Join-Path $installersDir 'requestRouter_amd64.msi') `
    -Step 4

# ===== STEP 5: Enable ARR proxy =====
Enable-ARRProxy

# ===== STEP 6: Allow X-Forwarded-Proto =====
Add-AllowedServerVariable -Name 'HTTP_X_FORWARDED_PROTO'

# ===== STEP 7: Node.js =====
Install-NodeJS -MsiPath (Join-Path $installersDir 'node-v18.20.4-x64.msi')

# ===== STEP 8: PostgreSQL =====
$pgInstaller = Get-ChildItem -Path $installersDir -Filter 'postgresql-*-windows-x64.exe' | Select-Object -First 1
if (-not $pgInstaller) { throw "PostgreSQL installer not found in $installersDir" }
Install-PostgreSQL -InstallerExe $pgInstaller.FullName `
    -SuperPassword $config.PgSuperPassword `
    -Port $config.PgPort

# ===== STEP 9: Bootstrap DB =====
Initialize-AppDatabase -SuperPassword $config.PgSuperPassword `
    -AppDbPassword $config.AppDbPassword `
    -DbName $config.DbName `
    -DbUser $config.DbUser `
    -Port $config.PgPort

# ===== STEP 10: Deploy app files =====
$envBackup = Copy-AppFiles -PayloadAppDir $payloadAppDir -InstallDir $config.InstallDir -BackendPort $config.BackendPort

# ===== STEP 11: Generate .env =====
Write-DotEnv -InstallDir $config.InstallDir -Config $config

# ===== STEP 12: npm install =====
Invoke-NpmInstall -BackendPath (Join-Path $config.InstallDir 'backend')

# ===== STEP 13: DB migration =====
Invoke-DbMigration -BackendPath (Join-Path $config.InstallDir 'backend')

# ===== STEP 13b: Seed admin user (super_admin) =====
if ($config.AdminEmail -and $config.AdminPassword) {
    Seed-AdminUser -BackendPath    (Join-Path $config.InstallDir 'backend') `
                   -AdminEmail     $config.AdminEmail `
                   -AdminPassword  $config.AdminPassword `
                   -AdminName      $config.AdminName `
                   -DbName         $config.DbName `
                   -DbUser         $config.DbUser `
                   -AppDbPassword  $config.AppDbPassword `
                   -Port           $config.PgPort
} else {
    Write-Log -Level WARN -Message 'AdminEmail/AdminPassword not in config.json - skipping admin seed. First login will fail until a user row is created manually.'
}

# ===== STEP 14: NTFS perms =====
Set-NTFSPermissions -InstallDir $config.InstallDir

# ===== STEP 15: IIS site =====
New-FlowAccelSite -SiteName $config.SiteName `
    -AppPoolName $config.AppPoolName `
    -PhysicalPath (Join-Path $config.InstallDir 'dist') `
    -HttpPort $config.HttpPort

# ===== STEPS 16-18: TLS certificates / HTTPS binding =====
# Removed in FlowAccel 1.0.3 - the app is served over HTTP on port 80 only.
# HTTP keeps the install fully IP-independent: no certificate is tied to a
# fixed address, so the machine's IP can change without breaking anything.

# ===== STEP 19: NSSM =====
$nssmExe = Install-NSSM -ZipPath (Join-Path $installersDir 'nssm-2.24.zip') `
    -DestDir (Join-Path $config.InstallDir 'nssm')

# ===== STEP 20: Register backend service =====
$nodeExe = (Get-Command node -ErrorAction Stop).Source
Register-BackendService -NssmExe $nssmExe `
    -ServiceName $config.ServiceName `
    -NodeExe $nodeExe `
    -ServerJs (Join-Path $config.InstallDir 'backend\server.js') `
    -AppDir (Join-Path $config.InstallDir 'backend') `
    -LogDir (Join-Path $config.InstallDir 'logs')

# ===== STEP 21: Firewall =====
Set-FirewallRules -HttpPort $config.HttpPort `
    -BackendPort $config.BackendPort `
    -PgPort $config.PgPort `
    -NodeExe $nodeExe `
    -AllowIcmp $config.AllowIcmp

# ===== STEP 22: Start backend =====
Start-BackendService -ServiceName $config.ServiceName -Port $config.BackendPort

# ===== STEP 23: Start site =====
Start-FlowAccelSite -SiteName $config.SiteName

# ===== STEP 24: Verify (Tier 1 infra + Tier 2 auth) =====
$verifyArgs = @{
    ServerIP      = '127.0.0.1'
    HttpPort      = $config.HttpPort
    BackendPort   = $config.BackendPort
    PgPort        = $config.PgPort
    ServiceName   = $config.ServiceName
    DbName        = $config.DbName
    DbUser        = $config.DbUser
    AppDbPassword = $config.AppDbPassword
    AdminEmail    = $config.AdminEmail
    AdminPassword = $config.AdminPassword
    JsonReportDir = (Join-Path $config.InstallDir 'logs')
}
$result = Invoke-Verification @verifyArgs

# ===== STEP 24b: Auto-remediate known failures, then re-verify once =====
if ($result.Fail -gt 0) {
    Write-Log -Level WARN -Message "$($result.Fail) check(s) failed - attempting deterministic auto-remediation."
    $remediation = Invoke-AutoRemediate -VerifyResult $result -Config $config -InstallDir $config.InstallDir
    if ($remediation.CuresAttempted.Count -gt 0) {
        Write-Log -Level INFO -Message "Re-running verification after auto-remediation."
        $result = Invoke-Verification @verifyArgs
    }
}

# ===== STEP 25: Finish =====
Write-StepHeader -Number 25 -Total 25 -Title 'Installation complete'
Write-Host ""
Write-Host "  Frontend URL:      http://$primaryIp/" -ForegroundColor Green
Write-Host "  Also reachable at: http://localhost/  (and any other IP of this machine)"
Write-Host "  Backend service:   $($config.ServiceName)  (autostart on boot)"
Write-Host "  Install dir:       $($config.InstallDir)"
Write-Host "  Logs:              $logFile"
Write-Host "  Config:            $ConfigPath"
Write-Host ""
Write-Host "  Uninstall: Control Panel > Programs > FlowAccel"
Write-Host ""
if ($envBackup) {
    Write-Host "  Previous .env preserved at: $envBackup" -ForegroundColor Yellow
}
exit 0
