@echo off
setlocal

REM ============================================================
REM  build-installer-zip.bat
REM  Wraps the pre-built FlowAccel-Setup-1.0.2.exe in a 7-Zip
REM  multi-volume archive split into 90 MB chunks, placed under
REM  frontend\public\installer\ so Vercel can serve them as
REM  static files. End users open .7z.001 in 7-Zip to extract
REM  the runnable .exe.
REM
REM  Prerequisites:
REM    - 7-Zip 19+ installed (winget install 7zip.7zip)
REM    - "FlowAccel Installer\build-installer.bat" already ran
REM      and produced output\FlowAccel-Setup-1.0.2.exe
REM ============================================================

set "REPO=%~dp0"
set "SRC=%REPO%FlowAccel Installer\output\FlowAccel-Setup-1.0.2.exe"
set "OUT=%REPO%frontend\public\installer"
set "SEVENZ="
if exist "C:\Program Files\7-Zip\7z.exe"       set "SEVENZ=C:\Program Files\7-Zip\7z.exe"
if exist "C:\Program Files (x86)\7-Zip\7z.exe" set "SEVENZ=C:\Program Files (x86)\7-Zip\7z.exe"
if "%SEVENZ%"=="" (
  echo [ERROR] 7z.exe not found. Install 7-Zip: winget install 7zip.7zip
  exit /b 1
)

if not exist "%SRC%" (
  echo [ERROR] "%SRC%" not found.
  echo         Build it first:
  echo           "%REPO%FlowAccel Installer\build-installer.bat"
  exit /b 1
)

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

echo [INFO] Splitting FlowAccel-Setup-1.0.2.exe into 90 MB 7-Zip volumes...
REM -mx=0 = store only (no recompression; .exe payload is already LZMA-packed)
REM -v90m = 90 MB per volume
"%SEVENZ%" a -t7z -mx=0 -v90m "%OUT%\FlowAccel-Setup-1.0.2.7z" "%SRC%"
if errorlevel 1 (
  echo [ERROR] 7-Zip split failed.
  exit /b 1
)

echo [INFO] Computing SHA256 hashes...
powershell -NoProfile -Command ^
  "$out = '%OUT%';" ^
  "$src = '%SRC%';" ^
  "$parts = Get-ChildItem -Path $out -Filter 'FlowAccel-Setup-1.0.2.7z.*' | Sort-Object Name;" ^
  "$lines = @();" ^
  "foreach ($p in $parts) { $h = (Get-FileHash -Algorithm SHA256 -Path $p.FullName).Hash.ToLower(); $lines += ($h + '  ' + $p.Name) };" ^
  "$exeHash = (Get-FileHash -Algorithm SHA256 -Path $src).Hash.ToLower();" ^
  "$lines += ($exeHash + '  extracted (FlowAccel-Setup-1.0.2.exe)');" ^
  "Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $lines -Encoding ASCII"
if errorlevel 1 exit /b 1

REM Hard-fail if any part > 95 MB
powershell -NoProfile -Command ^
  "$bad = Get-ChildItem -Path '%OUT%' -Filter 'FlowAccel-Setup-1.0.2.7z.*' | Where-Object { $_.Length -gt 95MB };" ^
  "if ($bad) { Write-Host '[ERROR] Parts over 95 MB:'; $bad | ForEach-Object { Write-Host $_.Name $_.Length }; exit 1 }"
if errorlevel 1 exit /b 1

copy /y "%REPO%installer-README.txt" "%OUT%\README.txt" >nul
if errorlevel 1 (
  echo [ERROR] Could not copy installer-README.txt.
  exit /b 1
)

echo.
echo [OK] Wrote chunks to %OUT%
dir /b "%OUT%"
endlocal
