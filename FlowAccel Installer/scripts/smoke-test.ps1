# smoke-test.ps1 - Standalone, read-only verification harness.
#
# Re-runs Invoke-Verification against an existing FlowAccel install using the
# values in config.json. Writes a separate timestamped log under {InstallDir}\logs.
# Exits 0 if all checks pass, 1 otherwise. Never mutates the install.

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ----- Bootstrap -----
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$libDir = Join-Path $here 'lib'
. (Join-Path $libDir 'log.ps1')
. (Join-Path $libDir 'postgres.ps1')
. (Join-Path $libDir 'verify.ps1')

# ----- Load config -----
if (-not (Test-Path $ConfigPath)) { throw "Config file not found: $ConfigPath" }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

$installDir = $cfg.InstallDir
if (-not $installDir) { throw 'InstallDir not set in config.json' }

# ----- Dedicated smoke log -----
$logFile = Join-Path $installDir ("logs\smoke-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Initialize-Log -Path $logFile
Write-Log -Level INFO -Message "Smoke test starting. Config: $ConfigPath"
Write-Log -Level INFO -Message "Install dir: $installDir"

# ----- Resolve config values with sane defaults -----
function Get-CfgValue {
    param($Obj, [string]$Name, $Default)
    if ($null -eq $Obj) { return $Default }
    $prop = $Obj.PSObject.Properties[$Name]
    if (-not $prop) { return $Default }
    $v = $prop.Value
    if ($null -eq $v -or ($v -is [string] -and $v -eq '')) { return $Default }
    return $v
}

# HTTP-only, IP-independent: probe the loopback address - the IIS site binds
# every interface, so 127.0.0.1 reaches it regardless of the machine's IP.
$serverIP      =      Get-CfgValue $cfg 'ServerIP'     '127.0.0.1'
$httpPort      = [int](Get-CfgValue $cfg 'HttpPort'    80)
$backendPort   = [int](Get-CfgValue $cfg 'BackendPort' 3001)
$pgPort        = [int](Get-CfgValue $cfg 'PgPort'      5432)
$dbName        =      Get-CfgValue $cfg 'DbName'        'jotflow'
$dbUser        =      Get-CfgValue $cfg 'DbUser'        'jotflow'
$appDbPassword =      Get-CfgValue $cfg 'AppDbPassword' $null
$adminEmail    =      Get-CfgValue $cfg 'AdminEmail'    $null
$adminPassword =      Get-CfgValue $cfg 'AdminPassword' $null

$jsonReportDir = Join-Path $installDir 'logs'
if (-not (Test-Path $jsonReportDir)) { New-Item -ItemType Directory -Force -Path $jsonReportDir | Out-Null }

# ----- Run verification (read-only) -----
$r = Invoke-Verification `
    -ServerIP      $serverIP `
    -HttpPort      $httpPort `
    -BackendPort   $backendPort `
    -PgPort        $pgPort `
    -DbName        $dbName `
    -DbUser        $dbUser `
    -AppDbPassword $appDbPassword `
    -AdminEmail    $adminEmail `
    -AdminPassword $adminPassword `
    -JsonReportDir $jsonReportDir

# ----- Summary -----
$pass = if ($r.PSObject.Properties['Pass']) { [int]$r.Pass } else { 0 }
$fail = if ($r.PSObject.Properties['Fail']) { [int]$r.Fail } else { 0 }
$report = if ($r.PSObject.Properties['ReportPath']) { $r.ReportPath } else { '(none)' }

Write-Log -Level INFO -Message "Smoke verification: Pass=$pass Fail=$fail"
Write-Log -Level INFO -Message "Report: $report"
Write-Log -Level INFO -Message "Log:    $logFile"

Write-Host ""
if ($fail -eq 0) {
    Write-Host "[OK]  Smoke test PASSED ($pass checks)." -ForegroundColor Green
    exit 0
} else {
    Write-Host "[!!]  Smoke test FAILED: $fail of $($pass + $fail) checks failing." -ForegroundColor Red
    Write-Host "      See JSON report:  $report"
    Write-Host "      See smoke log:    $logFile"
    exit 1
}
