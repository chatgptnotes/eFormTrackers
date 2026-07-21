# ssl.ps1 - Steps 16-18: Root CA, leaf cert, IIS HTTPS binding.

$script:RootCASubject = 'CN=FlowAccel-LAN-RootCA, O=FlowAccel, OU=LAN'
$script:RootCAYears   = 10
$script:LeafYears     = 2

function Get-RootCA {
    Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.Subject -eq $script:RootCASubject } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

function New-RootCA {
    Write-StepHeader -Number 16 -Total 25 -Title 'Generating internal Root CA (10-year)'
    $existing = Get-RootCA
    if ($existing) {
        Write-Log -Level OK -Message "Root CA already exists (thumbprint $($existing.Thumbprint)); skipping."
        return $existing
    }
    $ca = New-SelfSignedCertificate `
        -Subject $script:RootCASubject `
        -KeyUsage CertSign,CRLSign,DigitalSignature `
        -KeyUsageProperty Sign `
        -KeyLength 4096 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -NotAfter (Get-Date).AddYears($script:RootCAYears) `
        -TextExtension @('2.5.29.19={text}CA=true&pathlength=0') `
        -KeyExportPolicy Exportable
    Write-Log -Level OK -Message "Root CA created (thumbprint $($ca.Thumbprint))."
    return $ca
}

function Trust-RootCA {
    param([Parameter(Mandatory)]$Cert)
    Write-StepHeader -Number 17 -Total 25 -Title "Trusting Root CA in server's Trusted Root store"
    foreach ($store in @('Root','AuthRoot')) {
        $present = Get-ChildItem "Cert:\LocalMachine\$store" -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $Cert.Thumbprint }
        if ($present) {
            Write-Log -Level OK -Message "Root CA already in $store; skipping."
            continue
        }
        $s = New-Object System.Security.Cryptography.X509Certificates.X509Store($store,'LocalMachine')
        $s.Open('ReadWrite')
        $s.Add($Cert)
        $s.Close()
        Write-Log -Level OK -Message "Root CA imported into $store."
    }
}

function New-LeafCertificate {
    param(
        [Parameter(Mandatory)]$RootCA,
        [Parameter(Mandatory)][string]$CN,
        [string[]]$ExtraSANs = @()
    )
    Write-StepHeader -Number 16 -Total 25 -Title "Generating server leaf cert for CN=$CN"

    # Build SAN list. IP detected automatically if CN parses as IP.
    $sanParts = @()
    $ipMatch = $null
    if ([System.Net.IPAddress]::TryParse($CN, [ref]$ipMatch)) {
        $sanParts += "IPAddress=$CN"
        $sanParts += "DNS=$CN"
    } else {
        $sanParts += "DNS=$CN"
    }
    foreach ($s in $ExtraSANs) {
        if ([string]::IsNullOrWhiteSpace($s)) { continue }
        $tmp = $null
        if ([System.Net.IPAddress]::TryParse($s.Trim(), [ref]$tmp)) {
            $sanParts += "IPAddress=$($s.Trim())"
            $sanParts += "DNS=$($s.Trim())"
        } else {
            $sanParts += "DNS=$($s.Trim())"
        }
    }
    $sanExt = '2.5.29.17={text}' + ($sanParts -join '&')

    # Check for matching existing leaf
    $existing = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.Subject -eq "CN=$CN" -and $_.Issuer -eq $RootCA.Subject } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
    if ($existing) {
        Write-Log -Level OK -Message "Leaf cert for CN=$CN already issued by current Root CA; skipping."
        return $existing
    }

    $leaf = New-SelfSignedCertificate `
        -Subject "CN=$CN" `
        -Signer $RootCA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -NotAfter (Get-Date).AddYears($script:LeafYears) `
        -KeyUsage DigitalSignature,KeyEncipherment `
        -TextExtension @($sanExt, '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
        -KeyExportPolicy Exportable
    Write-Log -Level OK -Message "Leaf cert created (thumbprint $($leaf.Thumbprint))."
    return $leaf
}

function Import-OperatorPFX {
    param(
        [Parameter(Mandatory)][string]$PfxPath,
        [Parameter(Mandatory)][SecureString]$PfxPassword
    )
    Write-StepHeader -Number 17 -Total 25 -Title 'Importing operator-supplied PFX certificate'
    if (-not (Test-Path $PfxPath)) { throw "PFX file not found: $PfxPath" }
    $cert = Import-PfxCertificate `
        -FilePath $PfxPath `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -Password $PfxPassword `
        -Exportable
    Write-Log -Level OK -Message "PFX imported (thumbprint $($cert.Thumbprint))."
    return $cert
}

function Build-TrustBundle {
    param(
        [Parameter(Mandatory)]$RootCA,
        [Parameter(Mandatory)][string]$DistPath
    )
    Write-StepHeader -Number 17 -Total 25 -Title 'Building client trust bundle (Root CA distribution kit)'
    $bundle = Join-Path $DistPath 'trust-flowaccel'
    if (-not (Test-Path $bundle)) { New-Item -ItemType Directory -Force -Path $bundle | Out-Null }

    $cerPath = Join-Path $bundle 'FlowAccel-RootCA.cer'
    $bytes = $RootCA.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    [System.IO.File]::WriteAllBytes($cerPath, $bytes)

    # install-trust.bat
    @"
@echo off
REM FlowAccel LAN Root CA - One-click trust installer
REM Self-elevates via UAC, imports FlowAccel-RootCA.cer into LocalMachine\Root.

>nul 2>&1 net session
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
certutil -addstore -f "Root" "FlowAccel-RootCA.cer"
if %errorlevel% equ 0 (
  echo.
  echo [OK] FlowAccel Root CA trusted on this machine.
  echo Thumbprint: $($RootCA.Thumbprint)
) else (
  echo [ERROR] certutil failed with exit code %errorlevel%.
)
pause
"@ | Set-Content -Path (Join-Path $bundle 'install-trust.bat') -Encoding ASCII

    # install-trust.ps1
    @"
# FlowAccel LAN Root CA - PowerShell trust installer
# Requires admin. Usage:
#   iwr http://<server-ip>/trust-flowaccel/install-trust.ps1 -UseBasicParsing | iex

`$ErrorActionPreference = 'Stop'
`$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object System.Security.Principal.WindowsPrincipal(`$id)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Must run as Administrator.'
}
`$cerUrl = 'http://' + (`$MyInvocation.MyCommand.Definition -replace '.*//','' -split '/')[0] + '/trust-flowaccel/FlowAccel-RootCA.cer'
`$tmp = Join-Path `$env:TEMP 'FlowAccel-RootCA.cer'
if (Test-Path (Join-Path `$PSScriptRoot 'FlowAccel-RootCA.cer')) {
  Copy-Item (Join-Path `$PSScriptRoot 'FlowAccel-RootCA.cer') `$tmp -Force
} else {
  Invoke-WebRequest -Uri `$cerUrl -OutFile `$tmp -UseBasicParsing
}
Import-Certificate -FilePath `$tmp -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
Write-Host '[OK] FlowAccel Root CA trusted. Thumbprint: $($RootCA.Thumbprint)' -ForegroundColor Green
"@ | Set-Content -Path (Join-Path $bundle 'install-trust.ps1') -Encoding UTF8

    # README.txt
    @"
FlowAccel LAN Root CA - Client Trust Distribution
==================================================

Thumbprint: $($RootCA.Thumbprint)
(Verify this matches the value printed by the FlowAccel installer's success page.)

WHY THIS EXISTS
---------------
FlowAccel uses HTTPS with an internal certificate authority so all traffic between
your browser and the server is encrypted. For your browser to trust that
certificate, you need to install this Root CA once. After that, every certificate
the FlowAccel server ever issues will be automatically trusted - no further setup
on this machine.

OPTION A - Windows (Easiest)
----------------------------
1. Double-click  install-trust.bat
2. Click "Yes" when Windows asks for administrator permission.
3. Done.

OPTION B - Windows (PowerShell one-liner, for admins)
-----------------------------------------------------
Open an elevated PowerShell and run:
  iwr http://<server-ip>/trust-flowaccel/install-trust.ps1 -UseBasicParsing | iex

OPTION C - Group Policy (Domain admins, recommended for fleets)
---------------------------------------------------------------
1. Save FlowAccel-RootCA.cer to a network share readable by all domain controllers.
2. Open Group Policy Management Editor on a DC.
3. Navigate to:
     Computer Configuration
       > Policies
         > Windows Settings
           > Security Settings
             > Public Key Policies
               > Trusted Root Certification Authorities
4. Right-click > Import... > select FlowAccel-RootCA.cer
5. Link the GPO to the OU(s) containing your client machines.
6. Run  gpupdate /force  on a client to verify.

OPTION D - macOS
----------------
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain FlowAccel-RootCA.cer

OPTION E - Linux (Debian/Ubuntu)
--------------------------------
sudo cp FlowAccel-RootCA.cer /usr/local/share/ca-certificates/FlowAccel-RootCA.crt
sudo update-ca-certificates

OPTION F - Linux (RHEL/CentOS/Fedora)
-------------------------------------
sudo cp FlowAccel-RootCA.cer /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust

OPTION G - iOS
--------------
Email FlowAccel-RootCA.cer to yourself, open the attachment in Mail. iOS will
prompt to install a profile. After install, go to:
  Settings > General > About > Certificate Trust Settings
  > toggle ON for "FlowAccel-LAN-RootCA"

OPTION H - Android
------------------
Settings > Security > Encryption & credentials > Install a certificate
> CA certificate > select FlowAccel-RootCA.cer

VERIFY YOU TRUSTED THE RIGHT CERTIFICATE (recommended)
------------------------------------------------------
After importing on Windows, run:
  certutil -store Root FlowAccel-LAN-RootCA

The output should include a line:
  Cert Hash(sha1): $($RootCA.Thumbprint)

If it doesn't match the thumbprint at the top of this file, STOP - someone
may have intercepted the certificate file. Re-download from the FlowAccel
server console directly.

REMOVAL
-------
Windows:  certutil -delstore Root "$($RootCA.Subject -replace '^CN=','' -replace ',.*','')"
macOS:    sudo security delete-certificate -c "FlowAccel-LAN-RootCA" /Library/Keychains/System.keychain
"@ | Set-Content -Path (Join-Path $bundle 'README.txt') -Encoding UTF8

    Write-Log -Level OK -Message "Trust bundle written to $bundle"
    return $bundle
}

function Set-IISHttpsBinding {
    param(
        [Parameter(Mandatory)][string]$SiteName,
        [Parameter(Mandatory)]$Cert,
        [int]$Port = 443
    )
    Write-StepHeader -Number 18 -Total 25 -Title "Binding HTTPS:$Port on site '$SiteName'"
    Import-Module WebAdministration -ErrorAction Stop

    $existing = Get-WebBinding -Name $SiteName -Protocol https -Port $Port -ErrorAction SilentlyContinue
    if ($existing) {
        # Check thumbprint
        $sslPath = "IIS:\SslBindings\0.0.0.0!$Port"
        $cur = Get-Item $sslPath -ErrorAction SilentlyContinue
        if ($cur -and $cur.Thumbprint -eq $Cert.Thumbprint) {
            Write-Log -Level OK -Message 'HTTPS binding already present with matching cert; skipping.'
            return
        }
        Remove-WebBinding -Name $SiteName -Protocol https -Port $Port -ErrorAction SilentlyContinue
        Remove-Item "IIS:\SslBindings\0.0.0.0!$Port" -ErrorAction SilentlyContinue
    }
    New-WebBinding -Name $SiteName -Protocol https -Port $Port -IPAddress '*' | Out-Null
    New-Item -Path "IIS:\SslBindings\0.0.0.0!$Port" -Thumbprint $Cert.Thumbprint -SSLFlags 0 | Out-Null
    Write-Log -Level OK -Message "HTTPS binding created with cert $($Cert.Thumbprint)."
}
