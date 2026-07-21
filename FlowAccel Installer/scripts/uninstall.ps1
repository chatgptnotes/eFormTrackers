# uninstall.ps1 - FlowAccel uninstaller. Reverse-order teardown.
#
# Usage:
#   .\uninstall.ps1 -ConfigPath <path>                 (interactive prompts)
#   .\uninstall.ps1 -ConfigPath <path> -KeepData       (skip DB drop, keep uploads/logs)
#   .\uninstall.ps1 -ConfigPath <path> -PurgeCA        (also remove Root CA from server)
#   .\uninstall.ps1 -ConfigPath <path> -Silent -KeepData
#   .\uninstall.ps1 -ConfigPath <path> -Rollback       (called by installer on abort)

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [switch]$KeepData,
    [switch]$PurgeCA,
    [switch]$RemoveSharedComponents,
    [switch]$Silent,
    [switch]$Rollback
)

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'lib\log.ps1')
. (Join-Path $here 'lib\firewall.ps1')

if (-not (Test-Path $ConfigPath)) {
    Write-Host "Config not found at $ConfigPath - using defaults." -ForegroundColor Yellow
    $cfg = [pscustomobject]@{
        InstallDir   = 'C:\inetpub\flowaccel'
        ServiceName  = 'FlowAccelBackend'
        SiteName     = 'FlowAccel'
        AppPoolName  = 'FlowAccelPool'
        DbName       = 'jotflow'
        DbUser       = 'jotflow'
        PgPort       = 5432
    }
} else {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
}

$installDir = $cfg.InstallDir
$serviceName = if ($cfg.PSObject.Properties.Name -contains 'ServiceName' -and $cfg.ServiceName) { $cfg.ServiceName } else { 'FlowAccelBackend' }
$siteName = if ($cfg.PSObject.Properties.Name -contains 'SiteName' -and $cfg.SiteName) { $cfg.SiteName } else { 'FlowAccel' }
$appPoolName = if ($cfg.PSObject.Properties.Name -contains 'AppPoolName' -and $cfg.AppPoolName) { $cfg.AppPoolName } else { 'FlowAccelPool' }

Initialize-Log -Path (Join-Path $env:TEMP ("flowaccel-uninstall-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date)))
if ($Rollback) {
    Write-Log -Level WARN -Message 'ROLLBACK mode - reversing partial install.'
}

function Confirm-Action {
    param([string]$Prompt, [bool]$Default = $false)
    if ($Silent) { return $Default }
    $suffix = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $resp = Read-Host "$Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($resp)) { return $Default }
    return ($resp -match '^[Yy]')
}

# --- Step R1: Stop and remove backend service ---
Write-Log -Level STEP -Message "Removing service '$serviceName'..."
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue }
    $nssmExe = Join-Path $installDir 'nssm\nssm.exe'
    if (Test-Path $nssmExe) {
        & $nssmExe remove $serviceName confirm | Out-Null
    } else {
        sc.exe delete $serviceName | Out-Null
    }
    Write-Log -Level OK -Message "Service '$serviceName' removed."
} else {
    Write-Log -Level INFO -Message 'Service not present.'
}

# --- Step R2: Remove IIS site + app pool ---
Write-Log -Level STEP -Message "Removing IIS site '$siteName' and pool '$appPoolName'..."
try {
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    if (Get-Website -Name $siteName -ErrorAction SilentlyContinue) {
        Stop-Website -Name $siteName -ErrorAction SilentlyContinue
        Remove-Website -Name $siteName
        Write-Log -Level OK -Message "Site '$siteName' removed."
    }
    if (Test-Path "IIS:\AppPools\$appPoolName") {
        Remove-WebAppPool -Name $appPoolName
        Write-Log -Level OK -Message "App pool '$appPoolName' removed."
    }
} catch {
    Write-Log -Level WARN -Message "IIS teardown error: $($_.Exception.Message)"
}

# --- Step R3: Firewall rules ---
Write-Log -Level STEP -Message 'Removing firewall rules...'
Remove-FirewallRules

# --- Step R4: Certificates (leaf always; Root CA only if -PurgeCA) ---
$leafThumb = Get-Content (Join-Path $installDir '.cert-thumbprint') -ErrorAction SilentlyContinue
$rootThumb = Get-Content (Join-Path $installDir '.rootca-thumbprint') -ErrorAction SilentlyContinue
if ($leafThumb) {
    foreach ($store in 'My','Root','AuthRoot') {
        $c = Get-ChildItem "Cert:\LocalMachine\$store" -ErrorAction SilentlyContinue |
             Where-Object { $_.Thumbprint -eq $leafThumb }
        if ($c) {
            $c | Remove-Item -Force
            Write-Log -Level OK -Message "Leaf cert removed from $store."
        }
    }
}
if ($PurgeCA -and $rootThumb) {
    foreach ($store in 'My','Root','AuthRoot') {
        $c = Get-ChildItem "Cert:\LocalMachine\$store" -ErrorAction SilentlyContinue |
             Where-Object { $_.Thumbprint -eq $rootThumb }
        if ($c) {
            $c | Remove-Item -Force
            Write-Log -Level OK -Message "Root CA removed from $store."
        }
    }
} elseif ($rootThumb) {
    Write-Log -Level INFO -Message 'Root CA preserved (re-run with -PurgeCA to remove). Clients still trust it.'
}

# --- Step R5: Optionally drop application DB ---
$dropDb = if ($Silent) { $false } else { Confirm-Action -Prompt "Drop PostgreSQL database '$($cfg.DbName)' and user '$($cfg.DbUser)' (destroys data)?" -Default $false }
if ($dropDb) {
    $psqlPath = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
    if (Test-Path $psqlPath) {
        $pw = Read-Host -Prompt 'Postgres superuser password' -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
        $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        try {
            & $psqlPath -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS $($cfg.DbName);" | Out-Null
            & $psqlPath -h 127.0.0.1 -U postgres -c "DROP USER IF EXISTS $($cfg.DbUser);" | Out-Null
            Write-Log -Level OK -Message 'Database and user dropped.'
        } finally {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
    } else {
        Write-Log -Level WARN -Message 'psql not found; skipping DB drop.'
    }
}

# --- Step R6: Shared components prompt ---
if (-not $Rollback) {
    $remShared = if ($Silent) { $RemoveSharedComponents.IsPresent } else { Confirm-Action -Prompt 'Uninstall shared components (Node.js, PostgreSQL, URL Rewrite, ARR)? They may be used by other apps.' -Default $false }
    if ($remShared) {
        Write-Log -Level INFO -Message 'Shared components removal not automated - open "Apps & Features" to uninstall manually.'
    }
}

# --- Step R7: Remove install dir ---
if (Test-Path $installDir) {
    if ($KeepData) {
        Write-Log -Level INFO -Message 'Removing install dir but preserving uploads/ and logs/.'
        Get-ChildItem $installDir -Force | Where-Object { $_.Name -notin @('uploads','logs') } | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log -Level OK -Message "Install directory '$installDir' removed."
    }
}

# Remove resume shortcut if any
$shortcut = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Continue FlowAccel Setup.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force -ErrorAction SilentlyContinue }

Write-Banner -Status OK -Message 'FlowAccel uninstall complete.'
exit 0
