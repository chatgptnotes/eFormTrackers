@echo off
REM ===============================================================
REM  fix-iis-403.bat - Fix HTTP Error 403.14 on the FlowAccel site
REM  RIGHT-CLICK -> RUN AS ADMINISTRATOR
REM
REM  Cause: the IIS site was pointed at C:\inetpub\flowaccel, but the
REM  React build (index.html) and web.config live in the dist\
REM  subfolder. IIS finds no default document at the root -> 403.14.
REM
REM  Fix: repoint the site at ...\dist and make sure web.config is
REM  there too (IIS only loads web.config from the site's root).
REM ===============================================================

net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: This script must be run as Administrator!
    echo  Right-click fix-iis-403.bat -^> Run as administrator
    echo.
    pause
    exit /b 1
)

set "DST=C:\inetpub\flowaccel"
set "SITE=flowaccel"
set "APPCMD=%windir%\system32\inetsrv\appcmd.exe"

echo.
echo === Fixing FlowAccel IIS 403.14 ===
echo.

REM -- 1. Verify the React build is present --
if not exist "%DST%\dist\index.html" (
    echo  ERROR: "%DST%\dist\index.html" not found.
    echo  The React build was never deployed. Re-run the FlowAccel
    echo  installer, or copy the dist\ folder into %DST% first.
    echo.
    pause
    exit /b 1
)
echo [1/4] React build found: %DST%\dist\index.html

REM -- 2. Ensure web.config lives inside dist\ (the IIS site root) --
if exist "%DST%\dist\web.config" (
    echo [2/4] web.config already in dist\
) else (
    if exist "%DST%\web.config" (
        copy /Y "%DST%\web.config" "%DST%\dist\web.config" >nul
        echo [2/4] Copied web.config into dist\
    ) else (
        echo [2/4] WARNING: no web.config at %DST% or %DST%\dist - SPA
        echo        routing and the /api proxy will not work without it.
    )
)

REM -- 3. Repoint the IIS site at the dist\ folder --
"%APPCMD%" set vdir "%SITE%/" /physicalPath:"%DST%\dist"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: could not update site "%SITE%".
    echo  Open IIS Manager, check the exact site name, then edit the
    echo  SITE= line near the top of this script to match.
    echo.
    pause
    exit /b 1
)
echo [3/4] Site "%SITE%" physical path -^> %DST%\dist

REM -- 4. Restart IIS --
echo [4/4] Restarting IIS...
iisreset >nul
echo   Done.

echo.
echo ===============================================================
echo  FIXED. Reload the site in a browser - the 403.14 is gone.
echo ===============================================================
echo.
pause
