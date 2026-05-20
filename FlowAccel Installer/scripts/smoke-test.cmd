@echo off
REM smoke-test.cmd - Standalone re-run of Invoke-Verification against the
REM existing install. Read-only by contract: never calls Invoke-AutoRemediate.
REM
REM Layout assumption: this file lives at {InstallDir}\_payload\scripts\smoke-test.cmd
REM   %~dp0           -> {InstallDir}\_payload\scripts\
REM   %~dp0..\..\     -> {InstallDir}\
REM   config.json     -> {InstallDir}\config.json

setlocal

set "SCRIPT_DIR=%~dp0"
set "INSTALL_ROOT=%~dp0..\.."
set "CONFIG_PATH=%INSTALL_ROOT%\config.json"
set "PS_SCRIPT=%SCRIPT_DIR%smoke-test.ps1"

if not exist "%CONFIG_PATH%" (
    echo [smoke-test] ERROR: config.json not found at "%CONFIG_PATH%"
    pause
    exit /b 2
)
if not exist "%PS_SCRIPT%" (
    echo [smoke-test] ERROR: smoke-test.ps1 not found at "%PS_SCRIPT%"
    pause
    exit /b 2
)

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%PS_SCRIPT%" -ConfigPath "%CONFIG_PATH%"
set "RC=%ERRORLEVEL%"

echo.
echo [smoke-test] PowerShell exited with code %RC%.
pause
exit /b %RC%
