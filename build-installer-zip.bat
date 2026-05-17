@echo off
setlocal

REM ============================================================
REM  build-installer-zip.bat
REM  Builds a multi-volume zip of "FlowAccel Installer\" into
REM  frontend\public\installer\ so Vercel can serve the chunks
REM  as static files. Maintainer-run; not part of CI.
REM ============================================================

set "REPO=%~dp0"
set "INSTALLER=%REPO%FlowAccel Installer"
set "OUT=%REPO%frontend\public\installer"
set "SEVENZ=C:\Program Files\7-Zip\7z.exe"

if not exist "%SEVENZ%" (
  echo [ERROR] 7-Zip not found at "%SEVENZ%".
  echo         Install with:  winget install 7zip.7zip
  exit /b 1
)

if not exist "%INSTALLER%" (
  echo [ERROR] "%INSTALLER%" not found.
  exit /b 1
)

REM (a) Auto-fetch third-party payloads if PostgreSQL exe missing
if not exist "%INSTALLER%\payload\installers\postgresql-15.8-1-windows-x64.exe" (
  echo [INFO] Fetching third-party payloads...
  pushd "%INSTALLER%\payload\installers"
  powershell -ExecutionPolicy Bypass -File fetch-payloads.ps1
  if errorlevel 1 (
    popd
    echo [ERROR] fetch-payloads.ps1 failed.
    exit /b 1
  )
  popd
)

REM (b) Clean and recreate output directory
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

REM (c) Build multi-volume zip (90 MB chunks, fastest compression).
REM     -tzip          standard zip so rejoined file opens in Explorer
REM     -mx=1          payload is already-compressed binaries; faster is fine
REM     -v90m          90 MB volumes (safely under GitHub 100 MB limit)
REM     -xr!output     skip Inno Setup build output
REM     -xr!*.pfx -xr!*.cer  skip signing certs
echo [INFO] Building multi-volume zip...
"%SEVENZ%" a -tzip -mx=1 -v90m ^
  "%OUT%\FlowAccelInstaller.zip" "%INSTALLER%\*" ^
  -xr!output -xr!*.pfx -xr!*.cer
if errorlevel 1 (
  echo [ERROR] 7-Zip failed.
  exit /b 1
)

REM (d) Emit SHA256SUMS.txt (per-part hashes + merged-stream hash)
echo [INFO] Computing SHA256 hashes...
powershell -NoProfile -Command ^
  "$out = '%OUT%';" ^
  "$parts = Get-ChildItem -Path $out -Filter 'FlowAccelInstaller.zip.*' | Sort-Object Name;" ^
  "$lines = @();" ^
  "foreach ($p in $parts) { $h = (Get-FileHash -Algorithm SHA256 -Path $p.FullName).Hash.ToLower(); $lines += ($h + '  ' + $p.Name) };" ^
  "$sha = [System.Security.Cryptography.SHA256]::Create();" ^
  "$ms = New-Object System.IO.MemoryStream;" ^
  "foreach ($p in $parts) { $bytes = [System.IO.File]::ReadAllBytes($p.FullName); $ms.Write($bytes, 0, $bytes.Length) };" ^
  "$ms.Position = 0;" ^
  "$mergedHash = ([System.BitConverter]::ToString($sha.ComputeHash($ms))).Replace('-', '').ToLower();" ^
  "$lines += ($mergedHash + '  merged (FlowAccelInstaller.zip)');" ^
  "Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $lines -Encoding ASCII"
if errorlevel 1 (
  echo [ERROR] SHA256 computation failed.
  exit /b 1
)

REM (e) Hard-fail if any part exceeds 95 MB
powershell -NoProfile -Command ^
  "$bad = Get-ChildItem -Path '%OUT%' -Filter 'FlowAccelInstaller.zip.*' | Where-Object { $_.Length -gt 95MB };" ^
  "if ($bad) { Write-Host '[ERROR] Parts over 95 MB:'; $bad | ForEach-Object { Write-Host $_.Name $_.Length }; exit 1 }"
if errorlevel 1 exit /b 1

REM (f) Copy end-user README into the served folder
copy /y "%REPO%installer-README.txt" "%OUT%\README.txt" >nul
if errorlevel 1 (
  echo [ERROR] Could not copy installer-README.txt.
  exit /b 1
)

echo.
echo [OK] Wrote chunks to %OUT%
dir /b "%OUT%"
endlocal
