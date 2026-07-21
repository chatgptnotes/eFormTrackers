# Run on Windows from the root of this project:
#   powershell -ExecutionPolicy Bypass -File .\build-jotflow-installer.ps1
# Output: FlowAccel Installer\output\JotFlow-Setup-1.0.5.exe

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'This builds a Windows installer and must be run on Windows.' }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $root 'FlowAccel Installer'
if (-not (Test-Path (Join-Path $installer 'build-installer.bat'))) {
    throw "Installer source is missing: $installer"
}

$nodeZip = Join-Path $env:TEMP 'node-v18.20.4-win-x64.zip'
$nodeRoot = Join-Path $env:TEMP 'jotflow-node18'
if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.20.4/node-v18.20.4-win-x64.zip' -OutFile $nodeZip
}
Expand-Archive -Path $nodeZip -DestinationPath $nodeRoot -Force
$nodeDir = (Get-ChildItem -Path $nodeRoot -Directory | Select-Object -First 1).FullName
$env:Path = "$nodeDir;$env:Path"

$iscc = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
    $inno = Join-Path $env:TEMP 'innosetup.exe'
    Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile $inno
    Start-Process -FilePath $inno -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER' -Wait
}

Push-Location (Join-Path $installer 'payload\installers')
try {
    & powershell.exe -ExecutionPolicy Bypass -File .\fetch-payloads.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Dependency download failed.' }
} finally {
    Pop-Location
}

Push-Location $installer
try {
    & cmd.exe /c build-installer.bat
    if ($LASTEXITCODE -ne 0) { throw "Installer build failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}

$output = Join-Path $installer 'output\JotFlow-Setup-1.0.5.exe'
if (-not (Test-Path $output)) { throw "Build finished without creating $output" }
Write-Host "Built: $output" -ForegroundColor Green
