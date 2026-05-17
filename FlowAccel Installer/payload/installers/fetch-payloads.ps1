# fetch-payloads.ps1 - Download all third-party installer binaries needed to build the
# FlowAccel installer. Run on a dev machine with internet access before invoking
# build-installer.bat.
#
# Usage: powershell -ExecutionPolicy Bypass -File fetch-payloads.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$payloads = @(
    @{ Name = 'VC_redist.x64.exe';
       Url  = 'https://aka.ms/vs/17/release/vc_redist.x64.exe' },
    @{ Name = 'node-v18.20.4-x64.msi';
       Url  = 'https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi' },
    @{ Name = 'postgresql-15.8-1-windows-x64.exe';
       Url  = 'https://get.enterprisedb.com/postgresql/postgresql-15.8-1-windows-x64.exe' },
    @{ Name = 'rewrite_amd64_en-US.msi';
       Url  = 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' },
    @{ Name = 'requestRouter_amd64.msi';
       Url  = 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' },
    @{ Name = 'nssm-2.24.zip';
       Url  = 'https://nssm.cc/release/nssm-2.24.zip' }
)

foreach ($p in $payloads) {
    $dest = Join-Path $here $p.Name
    if (Test-Path $dest) {
        Write-Host "[skip] $($p.Name) already present." -ForegroundColor DarkGray
        continue
    }
    Write-Host "[fetch] $($p.Name) <- $($p.Url)" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $p.Url -OutFile $dest -UseBasicParsing
    $sz = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "  done ($sz MB)" -ForegroundColor Green
}

Write-Host ""
Write-Host "All payloads present. Compute hashes:" -ForegroundColor Yellow
Get-ChildItem -Path $here -File | Where-Object { $_.Name -notin 'fetch-payloads.ps1','README.txt','SHA256SUMS.txt' } | ForEach-Object {
    $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    "{0}  {1}" -f $h, $_.Name | Write-Host
}
