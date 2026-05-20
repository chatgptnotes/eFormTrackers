@echo off
REM RIGHT-CLICK → RUN AS ADMINISTRATOR

net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Run as Administrator!
    pause
    exit /b 1
)

set SRC=C:\Users\NODE08\Documents\Flowaccel\jotformTest14march
set DST=C:\inetpub\flowaccel

echo.
echo === Fixing JotFlow deployment ===
echo.

REM ── Grant full permissions ──
echo [1/5] Fixing permissions...
icacls "%DST%" /grant "Everyone:(OI)(CI)F" /T /Q
icacls "%DST%" /grant "IIS_IUSRS:(OI)(CI)F" /T /Q
echo   Done.

REM ── Copy dist ──
echo [2/5] Copying React build...
if exist "%DST%\dist" rmdir /S /Q "%DST%\dist"
mkdir "%DST%\dist"
xcopy "%SRC%\dist" "%DST%\dist\" /E /I /Y /Q
echo   Verifying...
if exist "%DST%\dist\index.html" (
    echo   OK — index.html found
) else (
    echo   FAILED — index.html missing!
)

REM ── Copy server.js and web.config ──
echo [3/5] Copying server.js and web.config...
copy /Y "%SRC%\server.js" "%DST%\server.js"
copy /Y "%SRC%\web.config" "%DST%\dist\web.config"

REM ── Check iisnode ──
echo [4/5] Checking iisnode...
if exist "C:\Program Files\iisnode\iisnode.dll" (
    echo   iisnode is installed.
) else (
    echo.
    echo   ****************************************************
    echo   *  iisnode is NOT INSTALLED!                        *
    echo   *                                                   *
    echo   *  Download and install:                            *
    echo   *  https://github.com/azure/iisnode/releases        *
    echo   *  File: iisnode-full-iis7-v0.2.26-x64.msi         *
    echo   *                                                   *
    echo   *  Then run this script again.                      *
    echo   ****************************************************
    echo.
    pause
    exit /b 1
)

REM ── Create IIS site + app pool ──
echo [5/5] Configuring IIS site...
%windir%\system32\inetsrv\appcmd.exe stop site "Default Web Site" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe delete site "flowaccel" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe delete apppool "flowaccel" >nul 2>nul
%windir%\system32\inetsrv\appcmd.exe add apppool /name:"flowaccel" /managedRuntimeVersion:""
%windir%\system32\inetsrv\appcmd.exe add site /name:"flowaccel" /physicalPath:"%DST%\dist" /bindings:http/*:80:
%windir%\system32\inetsrv\appcmd.exe set site "flowaccel" /applicationDefaults.applicationPool:"flowaccel"
echo   Done.

REM ── Create log + upload dirs ──
mkdir "%DST%\iisnode" >nul 2>nul
mkdir "%DST%\backend\uploads\avatars" >nul 2>nul
mkdir "%DST%\backend\uploads\signatures" >nul 2>nul
icacls "%DST%" /grant "IIS_IUSRS:(OI)(CI)F" /T /Q >nul

REM ── Restart IIS ──
echo.
echo Restarting IIS...
iisreset

echo.
echo ══════════════════════════════════════════════
echo  DONE! Open http://localhost in your browser
echo ══════════════════════════════════════════════
echo.
pause
