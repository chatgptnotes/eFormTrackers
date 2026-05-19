@echo off
REM ═══════════════════════════════════════════════════════════════
REM  JotFlow IIS Setup — RIGHT-CLICK → RUN AS ADMINISTRATOR
REM ═══════════════════════════════════════════════════════════════

net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: This script must be run as Administrator!
    echo  Right-click setup-iis.bat → Run as administrator
    echo.
    pause
    exit /b 1
)

set SRC=C:\Users\NODE08\Documents\Flowaccel\jotformTest14march
set DST=C:\inetpub\flowaccel

echo.
echo ╔══════════════════════════════════════════╗
echo ║   JotFlow IIS Setup (Admin)             ║
echo ╚══════════════════════════════════════════╝
echo.

REM ── Fix permissions on deployment folder ──
echo [1/7] Setting folder permissions...
icacls "%DST%" /grant "Everyone:(OI)(CI)F" /T /Q >nul 2>nul
icacls "%DST%" /grant "IIS_IUSRS:(OI)(CI)M" /T /Q >nul 2>nul
icacls "%DST%" /grant "IUSR:(OI)(CI)M" /T /Q >nul 2>nul
echo   Done.

REM ── Copy dist/ ──
echo [2/7] Copying React build (dist\)...
if exist "%DST%\dist\assets" rmdir /S /Q "%DST%\dist\assets" >nul 2>nul
xcopy "%SRC%\dist" "%DST%\dist\" /E /I /Y /Q >nul
echo   Done — %DST%\dist\index.html

REM ── Copy web.config and server.js ──
echo [3/7] Copying web.config and server.js...
copy /Y "%SRC%\web.config" "%DST%\dist\web.config" >nul
copy /Y "%SRC%\server.js" "%DST%\server.js" >nul
echo   Done.

REM ── Create upload dirs ──
echo [4/7] Creating upload directories...
if not exist "%DST%\backend\uploads\avatars" mkdir "%DST%\backend\uploads\avatars"
if not exist "%DST%\backend\uploads\signatures" mkdir "%DST%\backend\uploads\signatures"
echo   Done.

REM ── Create iisnode log dir ──
echo [5/7] Creating iisnode log directory...
if not exist "%DST%\iisnode" mkdir "%DST%\iisnode"
icacls "%DST%\iisnode" /grant "IIS_IUSRS:(OI)(CI)F" /T /Q >nul 2>nul
echo   Done.

REM ── Check iisnode ──
echo [6/7] Checking iisnode installation...
if exist "C:\Program Files\iisnode\iisnode.dll" (
    echo   iisnode is installed.
) else (
    echo.
    echo   *** iisnode is NOT installed! ***
    echo   Download from: https://github.com/azure/iisnode/releases
    echo   Get: iisnode-full-iis7-v0.2.26-x64.msi
    echo   Install it, then run this script again.
    echo.
    pause
    exit /b 1
)

REM ── Create IIS site ──
echo [7/7] Creating IIS website...
%windir%\system32\inetsrv\appcmd.exe delete site "flowaccel" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe add site /name:"flowaccel" /physicalPath:"%DST%\dist" /bindings:http/*:80: >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   Site may already exist or port 80 conflict. Check IIS Manager.
) else (
    echo   Site 'flowaccel' created on port 80.
)

REM Set app pool to No Managed Code
%windir%\system32\inetsrv\appcmd.exe delete apppool "flowaccel" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe add apppool /name:"flowaccel" /managedRuntimeVersion:"" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe set site "flowaccel" /applicationDefaults.applicationPool:"flowaccel" >nul 2>nul
echo   App pool set to No Managed Code.

REM ── Restart IIS ──
echo.
echo Restarting IIS...
iisreset >nul 2>nul
echo   Done.

echo.
echo ═══════════════════════════════════════════════════════════════
echo  SETUP COMPLETE!
echo ═══════════════════════════════════════════════════════════════
echo.
echo  Open browser: http://localhost
echo  Health check: http://localhost/api/health
echo.
pause
