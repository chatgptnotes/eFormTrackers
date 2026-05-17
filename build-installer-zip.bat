@echo off
setlocal

REM ============================================================
REM  build-installer-zip.bat
REM  Splits the pre-built FlowAccel-Setup-1.0.exe into 90 MB raw
REM  chunks placed under frontend\public\installer\ so Vercel can
REM  serve them as static files. End users `copy /b` the parts back
REM  to a runnable .exe; no Inno Setup or 7-Zip required on the
REM  user's machine.
REM
REM  Prerequisite: run "FlowAccel Installer\build-installer.bat"
REM  once to produce the .exe.
REM ============================================================

set "REPO=%~dp0"
set "SRC=%REPO%FlowAccel Installer\output\FlowAccel-Setup-1.0.exe"
set "OUT=%REPO%frontend\public\installer"

if not exist "%SRC%" (
  echo [ERROR] "%SRC%" not found.
  echo         Build it first:
  echo           "%REPO%FlowAccel Installer\build-installer.bat"
  exit /b 1
)

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

echo [INFO] Splitting FlowAccel-Setup-1.0.exe into 90 MB chunks...
powershell -NoProfile -Command ^
  "$src = '%SRC%';" ^
  "$out = '%OUT%';" ^
  "$chunk = 90 * 1024 * 1024;" ^
  "$buf = New-Object byte[] $chunk;" ^
  "$fs = [System.IO.File]::OpenRead($src);" ^
  "$i = 1;" ^
  "while (($r = $fs.Read($buf, 0, $buf.Length)) -gt 0) {" ^
  "  $name = '{0}\FlowAccel-Setup-1.0.exe.{1:D3}' -f $out, $i;" ^
  "  $pfs = [System.IO.File]::Create($name);" ^
  "  $pfs.Write($buf, 0, $r);" ^
  "  $pfs.Close();" ^
  "  $i++" ^
  "};" ^
  "$fs.Close()"
if errorlevel 1 (
  echo [ERROR] Split failed.
  exit /b 1
)

echo [INFO] Computing SHA256 hashes...
powershell -NoProfile -Command ^
  "$out = '%OUT%';" ^
  "$src = '%SRC%';" ^
  "$parts = Get-ChildItem -Path $out -Filter 'FlowAccel-Setup-1.0.exe.*' | Sort-Object Name;" ^
  "$lines = @();" ^
  "foreach ($p in $parts) { $h = (Get-FileHash -Algorithm SHA256 -Path $p.FullName).Hash.ToLower(); $lines += ($h + '  ' + $p.Name) };" ^
  "$mergedHash = (Get-FileHash -Algorithm SHA256 -Path $src).Hash.ToLower();" ^
  "$lines += ($mergedHash + '  merged (FlowAccel-Setup-1.0.exe)');" ^
  "Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $lines -Encoding ASCII"
if errorlevel 1 exit /b 1

REM Hard-fail if any part > 95 MB
powershell -NoProfile -Command ^
  "$bad = Get-ChildItem -Path '%OUT%' -Filter 'FlowAccel-Setup-1.0.exe.*' | Where-Object { $_.Length -gt 95MB };" ^
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
