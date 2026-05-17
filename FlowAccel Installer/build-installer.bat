@echo off
REM build-installer.bat - Build FlowAccel-Setup-1.0.exe
REM
REM Prerequisites on dev machine:
REM   - Node.js 18+ on PATH (npm)
REM   - Inno Setup 6 installed (ISCC.exe at "C:\Program Files (x86)\Inno Setup 6\ISCC.exe")
REM   - All five third-party binaries placed in payload\installers\ :
REM       VC_redist.x64.exe
REM       node-v18.20.4-x64.msi
REM       postgresql-15.8-1-windows-x64.exe
REM       rewrite_amd64_en-US.msi
REM       requestRouter_amd64.msi
REM       nssm-2.24.zip
REM
REM Output: output\FlowAccel-Setup-1.0.exe

setlocal EnableExtensions EnableDelayedExpansion
set HERE=%~dp0
set REPO=%HERE%..
set "ISCC="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" (
  echo ERROR: ISCC.exe not found. Install Inno Setup 6: winget install JRSoftware.InnoSetup
  exit /b 3
)
echo Using ISCC: "%ISCC%"

echo.
echo === FlowAccel installer build ===
echo.

REM ---- 1. Build frontend ----
echo [1/5] Building frontend...
pushd "%REPO%\frontend"
if exist package.json (
  call npm ci
  if errorlevel 1 ( echo Frontend npm ci failed & exit /b 1 )
  call npm run build
  if errorlevel 1 ( echo Frontend build failed & exit /b 1 )
) else (
  echo   WARN: frontend\package.json not found - skipping frontend build.
)
popd

REM ---- 2. Stage app payload ----
echo [2/5] Staging app payload...
set APP=%HERE%payload\app
if exist "%APP%" rmdir /s /q "%APP%"
mkdir "%APP%"
if exist "%REPO%\dist"        xcopy /e /i /y /q "%REPO%\dist"        "%APP%\dist"
if exist "%REPO%\frontend\dist" xcopy /e /i /y /q "%REPO%\frontend\dist" "%APP%\dist"
REM Strip recursive installer chunks - they are produced AFTER this .exe and must not embed an old copy of self.
if exist "%APP%\dist\installer" rmdir /s /q "%APP%\dist\installer"
xcopy /e /i /y /q "%REPO%\backend"   "%APP%\backend"   /exclude:%REPO%\deploy-exclude.txt 2>nul || xcopy /e /i /y /q "%REPO%\backend" "%APP%\backend"
copy /y "%REPO%\server.js"  "%APP%\server.js"
copy /y "%REPO%\web.config" "%APP%\web.config"
REM Remove node_modules - will be reinstalled on target by Step 12.
if exist "%APP%\backend\node_modules" rmdir /s /q "%APP%\backend\node_modules"

REM ---- 3. Verify installer payloads present ----
echo [3/5] Verifying third-party installer payloads...
set INSTALLERS=%HERE%payload\installers
set MISSING=0
for %%F in (VC_redist.x64.exe node-v18.20.4-x64.msi postgresql-15.8-1-windows-x64.exe rewrite_amd64_en-US.msi requestRouter_amd64.msi nssm-2.24.zip) do (
  if not exist "%INSTALLERS%\%%F" (
    echo   MISSING: %%F
    set /a MISSING+=1
  ) else (
    echo   OK: %%F
  )
)
if !MISSING! GTR 0 (
  echo.
  echo ERROR: !MISSING! installer payload^(s^) missing. See payload\installers\README.txt for download URLs.
  exit /b 2
)

REM ---- 4. Generate SHA256SUMS.txt for runtime integrity check ----
echo [4/5] Generating SHA256SUMS.txt...
pushd "%INSTALLERS%"
powershell -NoProfile -Command "Get-ChildItem -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' -and $_.Name -ne 'README.txt' } | ForEach-Object { '{0} {1}' -f ((Get-FileHash $_.FullName -Algorithm SHA256).Hash), $_.Name } | Set-Content -Path SHA256SUMS.txt -Encoding ASCII"
popd

REM ---- 5. Compile Inno Setup script ----
echo [5/5] Compiling Inno Setup script...
"%ISCC%" "%HERE%FlowAccel.iss"
if errorlevel 1 ( echo Inno Setup compile failed & exit /b 4 )

echo.
echo ============================================================
echo Build complete: %HERE%output\FlowAccel-Setup-1.0.exe
echo ============================================================
endlocal
