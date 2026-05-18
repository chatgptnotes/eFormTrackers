# =====================================================================
#  FlowAccel - enable HTTPS (port 443) so Microsoft login works
#  Run this file. It auto-asks for Administrator (click YES on UAC).
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
Import-Module WebAdministration

$ip   = '192.168.8.127'
$site = 'Flowaccel'

Write-Host "`n============ FlowAccel HTTPS Setup ============`n" -ForegroundColor Green

# 1. Self-signed certificate ------------------------------------------------
Write-Host "[1/4] Creating self-signed certificate for $ip..." -ForegroundColor Cyan
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq "CN=$ip" } | Select-Object -First 1
if (-not $cert) {
    $cert = New-SelfSignedCertificate -Subject "CN=$ip" -DnsName $ip `
        -CertStoreLocation 'Cert:\LocalMachine\My' -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(5) -Type SSLServerAuthentication
}
Write-Host "      Thumbprint: $($cert.Thumbprint)"

# Trust it on this machine so the local browser does not warn
$root = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
$root.Open('ReadWrite'); $root.Add($cert); $root.Close()

# 2. HTTPS binding on port 443 ----------------------------------------------
Write-Host "[2/4] Adding HTTPS binding (port 443) to site '$site'..." -ForegroundColor Cyan
if (-not (Get-WebBinding -Name $site -Protocol https -Port 443 -ErrorAction SilentlyContinue)) {
    New-WebBinding -Name $site -Protocol https -Port 443 -IPAddress '*'
}
$binding = Get-WebBinding -Name $site -Protocol https -Port 443
$binding.AddSslCertificate($cert.Thumbprint, 'My')

# 3. Firewall ----------------------------------------------------------------
Write-Host "[3/4] Opening firewall ports 443 and 8081..." -ForegroundColor Cyan
foreach ($p in 443, 8081) {
    if (-not (Get-NetFirewallRule -DisplayName "FlowAccel $p" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "FlowAccel $p" -Direction Inbound `
            -Protocol TCP -LocalPort $p -Action Allow | Out-Null
    }
}

# 4. Restart IIS + test ------------------------------------------------------
Write-Host "[4/4] Restarting IIS and testing..." -ForegroundColor Cyan
iisreset /restart | Out-Null
Start-Sleep -Seconds 3
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
function T($u) { try { $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 10; "OK ($($r.StatusCode))" }
                 catch { "FAIL - $($_.Exception.Message)" } }

Write-Host "`n================= RESULT =================" -ForegroundColor Green
Write-Host ("  https://$ip/             : {0}" -f (T "https://$ip/"))
Write-Host ("  https://$ip/api/health   : {0}" -f (T "https://$ip/api/health"))
Write-Host "==========================================`n" -ForegroundColor Green
Write-Host "Site is now also on:  https://$ip/" -ForegroundColor Green
Write-Host "Next: add the redirect URI in Azure Portal (see chat)." -ForegroundColor Green
