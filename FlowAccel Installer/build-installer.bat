@echo off
REM build-installer.bat - Build JotFlow-Setup-1.0.5.exe
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
REM Output: output\JotFlow-Setup-1.0.5.exe

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
  if exist node_modules (
    echo   node_modules already present - skipping install ^(avoids Windows/antivirus EPERM on npm ci^).
  ) else (
    call npm ci
    if errorlevel 1 ( echo Frontend npm ci failed & exit /b 1 )
  )
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
REM web.config is the installer's own HTTP-only template (with __BACKEND_PORT__
REM token) - NOT the repo-root web.config, which targets the local dev deploy.
copy /y "%HERE%config\web.config.template" "%APP%\web.config"
REM ---- 2b. VENDOR production node_modules for an OFFLINE-SAFE install ----
REM The #1 field failure was the ONLINE npm step dying at "Step 12 of 25" on a
REM target with no/limited internet, a proxy, or antivirus scanning ~30,000
REM files - which aborted the whole install and left the box with no website.
REM We now ship a clean production dependency tree INSIDE the installer so the
REM target never touches the network. NOTE: this build machine MUST be Windows
REM x64 with Node 18 so the bundled dependencies match the target platform.
if exist "%APP%\backend\node_modules" rmdir /s /q "%APP%\backend\node_modules"
if exist "%APP%\backend\package.json" (
  REM Build with the same Node major that the installer deploys (Node 18).
  for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node" 2^>nul') do set "NODEMAJOR=%%V"
  if not defined NODEMAJOR (
    echo ERROR: node not on PATH - cannot vendor backend deps. Install Node 18 and retry.
    exit /b 5
  )
  if not "!NODEMAJOR!"=="18" (
    echo ERROR: Node major is !NODEMAJOR! but the installer ships Node 18 to the target.
    echo        Build on Node 18 x64 so bundled dependencies match. Aborting.
    exit /b 5
  )
  echo   Vendoring production backend node_modules ^(offline deps, Node !NODEMAJOR! x64^)...
  pushd "%APP%\backend"
  call npm install --production --no-audit --no-fund --loglevel=error
  if errorlevel 1 ( echo Backend production npm install failed & popd & exit /b 5 )
  popd
) else (
  echo   WARN: backend\package.json not found - node_modules NOT vendored ^(install will fall back to online npm^).
)
REM SECURITY: never ship local secrets or runtime data inside the installer.
REM (The /exclude above can be bypassed by the || fallback xcopy, so scrub explicitly.)
if exist "%APP%\backend\.env"            del /f /q "%APP%\backend\.env"
if exist "%APP%\backend\.env.production" del /f /q "%APP%\backend\.env.production"
if exist "%APP%\backend\.env.local"      del /f /q "%APP%\backend\.env.local"
if exist "%APP%\backend\uploads"         rmdir /s /q "%APP%\backend\uploads"
if exist "%APP%\backend\logs"            rmdir /s /q "%APP%\backend\logs"

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
powershell -NoProfile -Command "$bundled = @('VC_redist.x64.exe','node-v18.20.4-x64.msi','postgresql-15.8-1-windows-x64.exe','rewrite_amd64_en-US.msi','requestRouter_amd64.msi','nssm-2.24.zip'); $bundled | ForEach-Object { '{0} {1}' -f ((Get-FileHash $_ -Algorithm SHA256).Hash), $_ } | Set-Content -Path SHA256SUMS.txt -Encoding ASCII"
popd

REM ---- 5. Compile Inno Setup script ----
echo [5/5] Compiling Inno Setup script...
"%ISCC%" "%HERE%FlowAccel.iss"
if errorlevel 1 ( echo Inno Setup compile failed & exit /b 4 )

echo.
echo ============================================================
echo Build complete: %HERE%output\JotFlow-Setup-1.0.5.exe
echo ============================================================
endlocal
